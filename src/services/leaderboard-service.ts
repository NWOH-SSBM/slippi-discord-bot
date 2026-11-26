import type { PlayerRecord, PlayerRepository } from '../database/player-repository.js';
import type {
  CachedPlayerProfile,
  ProfileCacheRepository,
} from '../database/profile-cache-repository.js';
import type { RankName } from '../domain/rank.js';
import { compareRanksDescending, resolveRank } from '../domain/rank.js';
import { SlippiApiError, type SlippiClient } from './slippi-client.js';

export const DEFAULT_PROFILE_CACHE_TTL_MS = 30 * 60 * 1_000;
export const DEFAULT_API_RETRY_DELAY_MS = 60 * 1_000;

export interface LeaderboardEntry {
  registration: PlayerRecord;
  profile: CachedPlayerProfile | undefined;
  rank: RankName;
}

export interface LeaderboardSnapshot {
  entries: LeaderboardEntry[];
  registeredPlayerCount: number;
  refreshedProfileCount: number;
  notFoundProfileCount: number;
  staleProfileCount: number;
  missingProfileCount: number;
  apiUnavailable: boolean;
}

export interface LeaderboardProgress {
  completed: number;
  total: number;
}

export interface LeaderboardServiceOptions {
  profileCacheTtlMs?: number;
  apiRetryDelayMs?: number;
}

/**
 * Coordinates roster retrieval, persistent profile caching, and rank ordering.
 * Cached profiles remain available if Slippi is unavailable; refresh failures
 * never delete registrations or overwrite the last successful profile.
 */
export class LeaderboardService {
  private readonly profileCacheTtlMs: number;
  private readonly apiRetryDelayMs: number;
  private retryAfter = 0;

  constructor(
    private readonly players: PlayerRepository,
    private readonly profiles: ProfileCacheRepository,
    private readonly slippi: SlippiClient,
    options: LeaderboardServiceOptions = {},
  ) {
    this.profileCacheTtlMs = validateNonNegativeInteger(
      options.profileCacheTtlMs ?? DEFAULT_PROFILE_CACHE_TTL_MS,
      'profileCacheTtlMs',
    );
    this.apiRetryDelayMs = validateNonNegativeInteger(
      options.apiRetryDelayMs ?? DEFAULT_API_RETRY_DELAY_MS,
      'apiRetryDelayMs',
    );
  }

  async getLeaderboard(
    guildId: string,
    onProgress?: (progress: LeaderboardProgress) => void | Promise<void>,
  ): Promise<LeaderboardSnapshot> {
    const registrations = this.players.list(guildId);

    if (registrations.length === 0) {
      return emptySnapshot();
    }

    const now = Date.now();
    const staleRegistrations = registrations.filter((registration) => {
      const profile = this.profiles.get(registration.connectCode);
      return !profile || isProfileStale(profile, this.profileCacheTtlMs, now);
    });

    let refreshedProfileCount = 0;
    let notFoundProfileCount = 0;
    let apiUnavailable = false;
    let completed = 0;
    let progressUpdatesEnabled = true;

    if (staleRegistrations.length > 0 && now < this.retryAfter) {
      apiUnavailable = true;
    } else {
      for (const registration of staleRegistrations) {
        try {
          const profile = await this.slippi.getPlayer(registration.connectCode);

          if (profile) {
            this.profiles.upsert(profile);
            refreshedProfileCount += 1;
          } else {
            // Do not delete a previous successful cache entry if the upstream
            // profile is temporarily missing or has been made unavailable.
            notFoundProfileCount += 1;
          }
        } catch (error) {
          if (!(error instanceof SlippiApiError)) {
            throw error;
          }

          apiUnavailable = true;
          this.retryAfter = Date.now() + this.apiRetryDelayMs;
          console.warn(
            `Slippi refresh failed for ${registration.connectCode}; using cached profile data where available.`,
            error,
          );
          break;
        }

        completed += 1;

        if (onProgress && progressUpdatesEnabled) {
          try {
            await onProgress({ completed, total: staleRegistrations.length });
          } catch (error) {
            // Discord progress edits are presentation-only. A transient webhook
            // failure must not abort a valid Slippi refresh.
            progressUpdatesEnabled = false;
            console.warn('Could not update leaderboard refresh progress:', error);
          }
        }
      }
    }

    const entries: LeaderboardEntry[] = registrations.map((registration) => {
      const profile = this.profiles.get(registration.connectCode);

      return {
        registration,
        profile,
        rank: profile ? resolveRank(profile) : 'Awaiting data',
      };
    });

    entries.sort(compareLeaderboardEntries);

    const snapshotNow = Date.now();
    const staleProfileCount = entries.filter(
      (entry) =>
        entry.profile !== undefined &&
        isProfileStale(entry.profile, this.profileCacheTtlMs, snapshotNow),
    ).length;
    const missingProfileCount = entries.filter((entry) => !entry.profile).length;

    return {
      entries,
      registeredPlayerCount: registrations.length,
      refreshedProfileCount,
      notFoundProfileCount,
      staleProfileCount,
      missingProfileCount,
      apiUnavailable,
    };
  }
}

/**
 * Rank takes precedence, then rating, then display name and Connect Code.
 * The final two keys make ordering stable when ratings are identical.
 */
export function compareLeaderboardEntries(left: LeaderboardEntry, right: LeaderboardEntry): number {
  const rankComparison = compareRanksDescending(left.rank, right.rank);

  if (rankComparison !== 0) {
    return rankComparison;
  }

  const leftRating = left.profile?.rating ?? Number.NEGATIVE_INFINITY;
  const rightRating = right.profile?.rating ?? Number.NEGATIVE_INFINITY;

  if (leftRating !== rightRating) {
    return rightRating - leftRating;
  }

  const leftName = left.profile?.displayName ?? left.registration.connectCode;
  const rightName = right.profile?.displayName ?? right.registration.connectCode;
  const nameComparison = leftName.localeCompare(rightName, 'en', {
    sensitivity: 'base',
  });

  return (
    nameComparison || left.registration.connectCode.localeCompare(right.registration.connectCode)
  );
}

function isProfileStale(profile: CachedPlayerProfile, ttlMs: number, now: number): boolean {
  const fetchedAt = Date.parse(profile.fetchedAt);
  return !Number.isFinite(fetchedAt) || now - fetchedAt >= ttlMs;
}

function emptySnapshot(): LeaderboardSnapshot {
  return {
    entries: [],
    registeredPlayerCount: 0,
    refreshedProfileCount: 0,
    notFoundProfileCount: 0,
    staleProfileCount: 0,
    missingProfileCount: 0,
    apiUnavailable: false,
  };
}

function validateNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer.`);
  }

  return value;
}
