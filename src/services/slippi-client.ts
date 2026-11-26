import { isValidConnectCode, normalizeConnectCode } from '../domain/connect-code.js';
import type { PlayerProfile } from '../domain/player-profile.js';

const DEFAULT_ENDPOINT = 'https://internal.slippi.gg';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_INTERVAL_MS = 1_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1_000;

const PLAYER_PROFILE_QUERY = `
  query UserProfilePageQuery($cc: String, $uid: String) {
    getUser(connectCode: $cc, fbUid: $uid) {
      fbUid
      displayName
      connectCode {
        code
      }
      rankedNetplayProfile {
        ratingOrdinal
        ratingUpdateCount
        wins
        losses
        dailyGlobalPlacement
        dailyRegionalPlacement
        continent
      }
    }
  }
`;

/** Backwards-compatible name for the normalized Slippi profile model. */
export type SlippiPlayer = PlayerProfile;

export interface SlippiClientOptions {
  endpoint?: string;
  timeoutMs?: number;
  requestIntervalMs?: number;
  cacheTtlMs?: number;
  fetchImplementation?: typeof fetch;
}

/**
 * Represents a failure communicating with Slippi or interpreting its response.
 * A missing player is not an error; getPlayer() returns null for that case.
 */
export class SlippiApiError extends Error {
  readonly statusCode: number | undefined;

  constructor(message: string, statusCode?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SlippiApiError';
    this.statusCode = statusCode;
  }
}

interface CacheEntry {
  expiresAt: number;
  player: SlippiPlayer | null;
}

/**
 * Small client for Slippi's currently used, undocumented GraphQL profile API.
 * Requests are serialized and spaced apart to avoid putting unnecessary load
 * on Slippi. Successful lookups and not-found results are cached briefly;
 * transport and API errors are never cached.
 */
export class SlippiClient {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly requestIntervalMs: number;
  private readonly cacheTtlMs: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<SlippiPlayer | null>>();

  private requestQueue: Promise<void> = Promise.resolve();
  private lastRequestStartedAt = 0;

  constructor(options: SlippiClientOptions = {}) {
    this.endpoint = validateEndpoint(options.endpoint ?? DEFAULT_ENDPOINT);
    this.timeoutMs = validatePositiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs');
    this.requestIntervalMs = validateNonNegativeInteger(
      options.requestIntervalMs ?? DEFAULT_REQUEST_INTERVAL_MS,
      'requestIntervalMs',
    );
    this.cacheTtlMs = validateNonNegativeInteger(
      options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      'cacheTtlMs',
    );
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  /**
   * Look up a Connect Code. Returns null only when Slippi explicitly reports
   * that no profile exists. Network, HTTP, GraphQL, and schema failures throw
   * SlippiApiError so callers cannot mistake an outage for a missing player.
   */
  async getPlayer(connectCode: string): Promise<SlippiPlayer | null> {
    const normalizedCode = normalizeConnectCode(connectCode);

    if (!isValidConnectCode(normalizedCode)) {
      throw new RangeError(
        'Connect Code must contain 1–7 letters and 1–7 digits, separated by #, a space, or a hyphen.',
      );
    }

    const cached = this.cache.get(normalizedCode);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.player;
    }

    if (cached) {
      this.cache.delete(normalizedCode);
    }

    const pending = this.inFlight.get(normalizedCode);

    if (pending) {
      return pending;
    }

    const request = this.enqueueRequest(() => this.fetchPlayer(normalizedCode));

    this.inFlight.set(normalizedCode, request);

    try {
      const player = await request;

      if (this.cacheTtlMs > 0) {
        this.cache.set(normalizedCode, {
          expiresAt: Date.now() + this.cacheTtlMs,
          player,
        });
      }

      return player;
    } finally {
      this.inFlight.delete(normalizedCode);
    }
  }

  private enqueueRequest<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.requestQueue.then(async () => {
      const elapsedMs = Date.now() - this.lastRequestStartedAt;
      const waitMs = Math.max(0, this.requestIntervalMs - elapsedMs);

      if (waitMs > 0) {
        await delay(waitMs);
      }

      this.lastRequestStartedAt = Date.now();
      return operation();
    });

    // Keep the queue usable after a rejected request while returning the
    // original rejection to the caller.
    this.requestQueue = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }

  private async fetchPlayer(connectCode: string): Promise<SlippiPlayer | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let payload: unknown = undefined;

    try {
      const response = await this.fetchImplementation(this.endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          operationName: 'UserProfilePageQuery',
          variables: {
            cc: connectCode,
            uid: connectCode,
          },
          query: PLAYER_PROFILE_QUERY,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new SlippiApiError(`Slippi API returned HTTP ${response.status}.`, response.status);
      }

      try {
        // Keep the timeout active while the response body is being consumed.
        payload = await response.json();
      } catch (error) {
        if (controller.signal.aborted) {
          throw error;
        }

        throw new SlippiApiError('Slippi API returned an unreadable JSON response.', undefined, {
          cause: error,
        });
      }
    } catch (error) {
      if (error instanceof SlippiApiError) {
        throw error;
      }

      if (controller.signal.aborted) {
        throw new SlippiApiError(
          `Slippi profile lookup timed out after ${this.timeoutMs} ms.`,
          undefined,
          { cause: error },
        );
      }

      throw new SlippiApiError('Unable to contact the Slippi API.', undefined, {
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }

    return parsePlayerResponse(payload, connectCode);
  }
}

function parsePlayerResponse(payload: unknown, requestedConnectCode: string): SlippiPlayer | null {
  const root = asRecord(payload);

  if (!root) {
    throw new SlippiApiError('Slippi API returned an invalid response.');
  }

  if (Array.isArray(root.errors) && root.errors.length > 0) {
    throw new SlippiApiError('Slippi GraphQL request returned an error.');
  }

  const data = asRecord(root.data);

  if (!data || !Object.hasOwn(data, 'getUser')) {
    throw new SlippiApiError('Slippi API response did not contain the expected player data.');
  }

  if (data.getUser === null) {
    return null;
  }

  const user = asRecord(data.getUser);

  if (!user) {
    throw new SlippiApiError('Slippi API returned malformed player data.');
  }

  const rawDisplayName = user.displayName;

  if (
    rawDisplayName !== null &&
    rawDisplayName !== undefined &&
    typeof rawDisplayName !== 'string'
  ) {
    throw new SlippiApiError('Slippi API returned an invalid player name.');
  }

  const displayName =
    typeof rawDisplayName === 'string' && rawDisplayName.trim()
      ? rawDisplayName.trim()
      : requestedConnectCode;

  const rawProfile = user.rankedNetplayProfile;
  let rating: number | null = null;
  let ratingUpdateCount: number | null = null;
  let wins: number | null = null;
  let losses: number | null = null;
  let dailyGlobalPlacement: number | null = null;
  let dailyRegionalPlacement: number | null = null;
  let continent: string | null = null;

  if (rawProfile !== null && rawProfile !== undefined) {
    const profile = asRecord(rawProfile);

    if (!profile) {
      throw new SlippiApiError('Slippi API returned malformed ranked data.');
    }

    rating = nullableNonNegativeNumber(profile.ratingOrdinal, 'ratingOrdinal');
    ratingUpdateCount = nullableNonNegativeInteger(profile.ratingUpdateCount, 'ratingUpdateCount');
    wins = nullableNonNegativeInteger(profile.wins, 'wins');
    losses = nullableNonNegativeInteger(profile.losses, 'losses');
    dailyGlobalPlacement = nullablePositiveInteger(
      profile.dailyGlobalPlacement,
      'dailyGlobalPlacement',
    );
    dailyRegionalPlacement = nullablePositiveInteger(
      profile.dailyRegionalPlacement,
      'dailyRegionalPlacement',
    );
    continent = nullableString(profile.continent, 'continent');
  }

  return {
    connectCode: requestedConnectCode,
    displayName,
    rating,
    ratingUpdateCount,
    wins,
    losses,
    dailyGlobalPlacement,
    dailyRegionalPlacement,
    continent,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function nullableNonNegativeNumber(value: unknown, fieldName: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new SlippiApiError(`Slippi API returned an invalid ${fieldName} value.`);
  }

  return value;
}

function nullableNonNegativeInteger(value: unknown, fieldName: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new SlippiApiError(`Slippi API returned an invalid ${fieldName} value.`);
  }

  return value as number;
}

function nullablePositiveInteger(value: unknown, fieldName: string): number | null {
  const result = nullableNonNegativeInteger(value, fieldName);

  if (result !== null && result < 1) {
    throw new SlippiApiError(`Slippi API returned an invalid ${fieldName} value.`);
  }

  return result;
}

function nullableString(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new SlippiApiError(`Slippi API returned an invalid ${fieldName} value.`);
  }

  return value;
}

function validateEndpoint(value: string): string {
  let endpoint: URL;

  try {
    endpoint = new URL(value);
  } catch (error) {
    throw new RangeError('Slippi GraphQL endpoint must be a valid HTTPS URL.', {
      cause: error,
    });
  }

  if (endpoint.protocol !== 'https:') {
    throw new RangeError('Slippi GraphQL endpoint must use HTTPS.');
  }

  return endpoint.toString();
}

function validatePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }

  return value;
}

function validateNonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer.`);
  }

  return value;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
