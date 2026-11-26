import { randomUUID } from 'node:crypto';
import type { LeaderboardSnapshot } from './leaderboard-service.js';
import { LEADERBOARD_PAGE_SIZE } from '../domain/leaderboard.js';

export type LeaderboardFormat = 'rich' | 'compact';

export interface LeaderboardSession {
  readonly id: string;
  readonly ownerUserId: string;
  readonly format: LeaderboardFormat;
  readonly snapshot: LeaderboardSnapshot;
  readonly pageCount: number;
  readonly createdAt: number;
  expiresAt: number;
  pageIndex: number;
}

export interface LeaderboardSessionStoreOptions {
  ttlMs?: number;
  maxSessions?: number;
  now?: () => number;
  createId?: () => string;
}

export const DEFAULT_LEADERBOARD_SESSION_TTL_MS = 30 * 60 * 1_000;
export const DEFAULT_MAX_LEADERBOARD_SESSIONS = 100;

/**
 * Process-local snapshots backing leaderboard pagination buttons.
 *
 * Buttons do not rely on long-lived MessageComponentCollectors. Their custom
 * IDs point back to a bounded snapshot store and remain safely acknowledgeable
 * after the snapshot expires or the process restarts.
 */
export class LeaderboardSessionStore {
  private readonly ttlMs: number;
  private readonly maxSessions: number;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly sessions = new Map<string, LeaderboardSession>();

  constructor(options: LeaderboardSessionStoreOptions = {}) {
    this.ttlMs = validatePositiveInteger(
      options.ttlMs ?? DEFAULT_LEADERBOARD_SESSION_TTL_MS,
      'ttlMs',
    );
    this.maxSessions = validatePositiveInteger(
      options.maxSessions ?? DEFAULT_MAX_LEADERBOARD_SESSIONS,
      'maxSessions',
    );
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
  }

  create(
    ownerUserId: string,
    format: LeaderboardFormat,
    snapshot: LeaderboardSnapshot,
  ): LeaderboardSession | undefined {
    if (!ownerUserId.trim()) {
      throw new RangeError('A leaderboard session requires an owner user ID.');
    }

    const pageCount = Math.ceil(snapshot.entries.length / LEADERBOARD_PAGE_SIZE);

    if (pageCount <= 1) {
      return undefined;
    }

    const now = this.now();
    this.prune(now);

    const session: LeaderboardSession = {
      id: this.createId(),
      ownerUserId,
      format,
      snapshot,
      pageCount,
      createdAt: now,
      expiresAt: now + this.ttlMs,
      pageIndex: 0,
    };

    this.sessions.set(session.id, session);
    this.enforceMaximumSessionCount();

    return session;
  }

  get(sessionId: string): LeaderboardSession | undefined {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return undefined;
    }

    const now = this.now();

    if (session.expiresAt <= now) {
      this.sessions.delete(sessionId);
      return undefined;
    }

    // Extend the session on use and move it to the end of insertion order so
    // maximum-capacity eviction behaves like a simple LRU policy.
    session.expiresAt = now + this.ttlMs;
    this.sessions.delete(sessionId);
    this.sessions.set(sessionId, session);
    return session;
  }

  setPage(sessionId: string, pageIndex: number): LeaderboardSession | undefined {
    const session = this.get(sessionId);

    if (!session) {
      return undefined;
    }

    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || pageIndex >= session.pageCount) {
      throw new RangeError('Requested leaderboard page is outside the session.');
    }

    session.pageIndex = pageIndex;
    return session;
  }

  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  get size(): number {
    this.prune(this.now());
    return this.sessions.size;
  }

  private prune(now: number): void {
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(id);
      }
    }
  }

  private enforceMaximumSessionCount(): void {
    while (this.sessions.size > this.maxSessions) {
      const oldestId = this.sessions.keys().next().value as string | undefined;

      if (!oldestId) {
        return;
      }

      this.sessions.delete(oldestId);
    }
  }
}

function validatePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer.`);
  }

  return value;
}
