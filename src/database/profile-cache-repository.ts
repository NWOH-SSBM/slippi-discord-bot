import type Database from 'better-sqlite3';
import { isValidConnectCode, normalizeConnectCode } from '../domain/connect-code.js';
import type { PlayerProfile } from '../domain/player-profile.js';
import type { SqliteDatabase } from './database.js';

export interface CachedPlayerProfile extends PlayerProfile {
  fetchedAt: string;
}

type UpsertParameters = [
  string,
  string,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  string | null,
  string,
];

/**
 * Persistent cache of the last successfully retrieved Slippi profile.
 * It is keyed globally by Connect Code so multiple guild rosters can share
 * one copy of the same upstream profile.
 */
export class ProfileCacheRepository {
  private readonly getStatement: Database.Statement<[string], CachedPlayerProfile>;
  private readonly upsertStatement: Database.Statement<UpsertParameters>;

  constructor(private readonly database: SqliteDatabase) {
    this.getStatement = database.prepare<[string], CachedPlayerProfile>(`
      SELECT
        connect_code AS connectCode,
        display_name AS displayName,
        rating,
        rating_update_count AS ratingUpdateCount,
        wins,
        losses,
        daily_global_placement AS dailyGlobalPlacement,
        daily_regional_placement AS dailyRegionalPlacement,
        continent,
        fetched_at AS fetchedAt
      FROM slippi_profiles
      WHERE connect_code = ?
    `);

    this.upsertStatement = database.prepare<UpsertParameters>(`
      INSERT INTO slippi_profiles (
        connect_code,
        display_name,
        rating,
        rating_update_count,
        wins,
        losses,
        daily_global_placement,
        daily_regional_placement,
        continent,
        fetched_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (connect_code) DO UPDATE SET
        display_name = excluded.display_name,
        rating = excluded.rating,
        rating_update_count = excluded.rating_update_count,
        wins = excluded.wins,
        losses = excluded.losses,
        daily_global_placement = excluded.daily_global_placement,
        daily_regional_placement = excluded.daily_regional_placement,
        continent = excluded.continent,
        fetched_at = excluded.fetched_at
    `);
  }

  get(connectCode: string): CachedPlayerProfile | undefined {
    return this.getStatement.get(normalizeStoredConnectCode(connectCode));
  }

  getMany(connectCodes: string[]): CachedPlayerProfile[] {
    const profiles: CachedPlayerProfile[] = [];
    const seen = new Set<string>();

    for (const connectCode of connectCodes) {
      const normalizedCode = normalizeStoredConnectCode(connectCode);

      if (seen.has(normalizedCode)) {
        continue;
      }

      seen.add(normalizedCode);
      const profile = this.getStatement.get(normalizedCode);

      if (profile) {
        profiles.push(profile);
      }
    }

    return profiles;
  }

  upsert(profile: PlayerProfile, fetchedAt = new Date().toISOString()): CachedPlayerProfile {
    const connectCode = normalizeStoredConnectCode(profile.connectCode);
    const displayName = profile.displayName.trim();

    if (!displayName) {
      throw new RangeError('Player display name must not be empty.');
    }

    if (!Number.isFinite(Date.parse(fetchedAt))) {
      throw new RangeError('Profile fetchedAt must be a valid timestamp.');
    }

    this.upsertStatement.run(
      connectCode,
      displayName,
      profile.rating,
      profile.ratingUpdateCount,
      profile.wins,
      profile.losses,
      profile.dailyGlobalPlacement,
      profile.dailyRegionalPlacement,
      profile.continent,
      fetchedAt,
    );

    const cachedProfile = this.getStatement.get(connectCode);

    if (!cachedProfile) {
      throw new Error('Profile upsert completed but the row could not be retrieved.');
    }

    return cachedProfile;
  }
}

function normalizeStoredConnectCode(value: string): string {
  const normalizedValue = normalizeConnectCode(value);

  if (!isValidConnectCode(normalizedValue)) {
    throw new RangeError('Connect Code must use the format ABCD#123.');
  }

  return normalizedValue;
}
