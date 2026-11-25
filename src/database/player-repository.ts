import type Database from 'better-sqlite3';
import { normalizeConnectCode } from '../domain/connect-code.js';
import type { SqliteDatabase } from './database.js';

export interface PlayerRecord {
  guildId: string;
  connectCode: string;
  addedByDiscordUserId: string;
  addedAt: string;
}

export type AddPlayerResult =
  | { status: 'added'; player: PlayerRecord }
  | { status: 'already-registered'; player: PlayerRecord };

/**
 * Persistence operations for the configured players in each Discord guild.
 * Slippi profile data is intentionally not stored here; the Slippi service is
 * the source of truth for player names and ratings.
 */
export class PlayerRepository {
  private readonly insertStatement: Database.Statement<[string, string, string]>;
  private readonly getStatement: Database.Statement<[string, string], PlayerRecord>;
  private readonly removeStatement: Database.Statement<[string, string]>;
  private readonly listStatement: Database.Statement<[string], PlayerRecord>;

  constructor(private readonly database: SqliteDatabase) {
    this.insertStatement = database.prepare<[string, string, string]>(`
      INSERT INTO players (
        guild_id,
        connect_code,
        added_by_discord_user_id
      )
      VALUES (?, ?, ?)
      ON CONFLICT (guild_id, connect_code) DO NOTHING
    `);

    this.getStatement = database.prepare<[string, string], PlayerRecord>(`
      SELECT
        guild_id AS guildId,
        connect_code AS connectCode,
        added_by_discord_user_id AS addedByDiscordUserId,
        added_at AS addedAt
      FROM players
      WHERE guild_id = ? AND connect_code = ?
    `);

    this.removeStatement = database.prepare<[string, string]>(`
      DELETE FROM players
      WHERE guild_id = ? AND connect_code = ?
    `);

    this.listStatement = database.prepare<[string], PlayerRecord>(`
      SELECT
        guild_id AS guildId,
        connect_code AS connectCode,
        added_by_discord_user_id AS addedByDiscordUserId,
        added_at AS addedAt
      FROM players
      WHERE guild_id = ?
      ORDER BY added_at ASC, connect_code ASC
    `);
  }

  add(guildId: string, connectCode: string, addedByDiscordUserId: string): AddPlayerResult {
    const normalizedGuildId = normalizeIdentifier(guildId, 'Guild ID');
    const normalizedConnectCode = normalizeStoredConnectCode(connectCode);
    const normalizedActorId = normalizeIdentifier(addedByDiscordUserId, 'Discord user ID');

    const result = this.insertStatement.run(
      normalizedGuildId,
      normalizedConnectCode,
      normalizedActorId,
    );

    const player = this.get(normalizedGuildId, normalizedConnectCode);

    if (!player) {
      throw new Error('Player insert completed but the row could not be retrieved.');
    }

    return result.changes === 1
      ? { status: 'added', player }
      : { status: 'already-registered', player };
  }

  get(guildId: string, connectCode: string): PlayerRecord | undefined {
    const normalizedGuildId = normalizeIdentifier(guildId, 'Guild ID');
    const normalizedConnectCode = normalizeStoredConnectCode(connectCode);

    return this.getStatement.get(normalizedGuildId, normalizedConnectCode);
  }

  remove(guildId: string, connectCode: string): boolean {
    const normalizedGuildId = normalizeIdentifier(guildId, 'Guild ID');
    const normalizedConnectCode = normalizeStoredConnectCode(connectCode);

    const result = this.removeStatement.run(normalizedGuildId, normalizedConnectCode);

    return result.changes === 1;
  }

  list(guildId: string): PlayerRecord[] {
    const normalizedGuildId = normalizeIdentifier(guildId, 'Guild ID');
    return this.listStatement.all(normalizedGuildId);
  }
}

function normalizeIdentifier(value: string, label: string): string {
  const normalizedValue = value.trim();

  if (!normalizedValue || normalizedValue.length > 64) {
    throw new RangeError(`${label} must contain between 1 and 64 characters.`);
  }

  return normalizedValue;
}

function normalizeStoredConnectCode(value: string): string {
  const normalizedValue = normalizeConnectCode(value);

  if (!normalizedValue || normalizedValue.length > 32) {
    throw new RangeError('Connect Code must contain between 1 and 32 characters.');
  }

  return normalizedValue;
}
