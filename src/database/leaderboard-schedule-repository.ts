import type Database from 'better-sqlite3';
import {
  normalizeLeaderboardScheduleInput,
  type LeaderboardSchedule,
  type SaveLeaderboardScheduleInput,
  type ScheduleRunStatus,
} from '../domain/leaderboard-schedule.js';
import type { SqliteDatabase } from './database.js';

type ScheduleRow = Omit<LeaderboardSchedule, 'enabled'> & { enabled: number };

type SaveParameters = [
  string,
  string,
  number,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

type SetEnabledParameters = [number, string, string, string];
type RecordRunParameters = [string, ScheduleRunStatus, string | null, string, string];

/** Persistence for the single recurring leaderboard schedule allowed per guild. */
export class LeaderboardScheduleRepository {
  private readonly getStatement: Database.Statement<[string], ScheduleRow>;
  private readonly listEnabledStatement: Database.Statement<[], ScheduleRow>;
  private readonly saveStatement: Database.Statement<SaveParameters>;
  private readonly setEnabledStatement: Database.Statement<SetEnabledParameters>;
  private readonly deleteStatement: Database.Statement<[string]>;
  private readonly recordRunStatement: Database.Statement<RecordRunParameters>;

  constructor(private readonly database: SqliteDatabase) {
    this.getStatement = database.prepare<[string], ScheduleRow>(`${selectScheduleSql}
      WHERE guild_id = ?
    `);

    this.listEnabledStatement = database.prepare<[], ScheduleRow>(`${selectScheduleSql}
      WHERE enabled = 1
      ORDER BY guild_id ASC
    `);

    this.saveStatement = database.prepare<SaveParameters>(`
      INSERT INTO leaderboard_schedule (
        guild_id,
        channel_id,
        frequency,
        day_of_week,
        local_time,
        time_zone,
        format,
        enabled,
        created_by_discord_user_id,
        updated_by_discord_user_id,
        created_at,
        updated_at
      )
      VALUES (?, ?, 'weekly', ?, ?, ?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT (guild_id) DO UPDATE SET
        channel_id = excluded.channel_id,
        frequency = excluded.frequency,
        day_of_week = excluded.day_of_week,
        local_time = excluded.local_time,
        time_zone = excluded.time_zone,
        format = excluded.format,
        enabled = 1,
        updated_by_discord_user_id = excluded.updated_by_discord_user_id,
        updated_at = excluded.updated_at
    `);

    this.setEnabledStatement = database.prepare<SetEnabledParameters>(`
      UPDATE leaderboard_schedule
      SET enabled = ?, updated_by_discord_user_id = ?, updated_at = ?
      WHERE guild_id = ?
    `);

    this.deleteStatement = database.prepare<[string]>(`
      DELETE FROM leaderboard_schedule WHERE guild_id = ?
    `);

    this.recordRunStatement = database.prepare<RecordRunParameters>(`
      UPDATE leaderboard_schedule
      SET
        last_run_at = ?,
        last_run_status = ?,
        last_error = ?,
        updated_at = ?
      WHERE guild_id = ?
    `);
  }

  get(guildId: string): LeaderboardSchedule | undefined {
    const row = this.getStatement.get(normalizeGuildId(guildId));
    return row ? mapScheduleRow(row) : undefined;
  }

  listEnabled(): LeaderboardSchedule[] {
    return this.listEnabledStatement.all().map(mapScheduleRow);
  }

  /** Create or replace the guild's one schedule; saving always enables it. */
  save(input: SaveLeaderboardScheduleInput, now = new Date().toISOString()): LeaderboardSchedule {
    const normalized = normalizeLeaderboardScheduleInput(input);
    validateTimestamp(now, 'updatedAt');

    this.saveStatement.run(
      normalized.guildId,
      normalized.channelId,
      normalized.dayOfWeek,
      normalized.localTime,
      normalized.timeZone,
      normalized.format,
      normalized.actorDiscordUserId,
      normalized.actorDiscordUserId,
      now,
      now,
    );

    const saved = this.get(normalized.guildId);

    if (!saved) {
      throw new Error('Schedule save completed but the row could not be retrieved.');
    }

    return saved;
  }

  setEnabled(
    guildId: string,
    enabled: boolean,
    actorDiscordUserId: string,
    now = new Date().toISOString(),
  ): LeaderboardSchedule | undefined {
    const normalizedGuildId = normalizeGuildId(guildId);
    const actorId = normalizeIdentifier(actorDiscordUserId, 'Discord user ID');
    validateTimestamp(now, 'updatedAt');

    this.setEnabledStatement.run(enabled ? 1 : 0, actorId, now, normalizedGuildId);
    return this.get(normalizedGuildId);
  }

  remove(guildId: string): boolean {
    const result = this.deleteStatement.run(normalizeGuildId(guildId));
    return result.changes === 1;
  }

  recordRun(
    guildId: string,
    status: ScheduleRunStatus,
    error: string | null = null,
    runAt = new Date().toISOString(),
  ): boolean {
    const normalizedGuildId = normalizeGuildId(guildId);
    validateTimestamp(runAt, 'runAt');

    if (status !== 'success' && status !== 'failure') {
      throw new RangeError('Schedule run status must be "success" or "failure".');
    }

    const normalizedError =
      status === 'failure' && error !== null ? error.trim().slice(0, 1_000) || null : null;

    const result = this.recordRunStatement.run(
      runAt,
      status,
      normalizedError,
      runAt,
      normalizedGuildId,
    );

    return result.changes === 1;
  }
}

const selectScheduleSql = `
  SELECT
    id,
    guild_id AS guildId,
    channel_id AS channelId,
    frequency,
    day_of_week AS dayOfWeek,
    local_time AS localTime,
    time_zone AS timeZone,
    format,
    enabled,
    created_by_discord_user_id AS createdByDiscordUserId,
    updated_by_discord_user_id AS updatedByDiscordUserId,
    created_at AS createdAt,
    updated_at AS updatedAt,
    last_run_at AS lastRunAt,
    last_run_status AS lastRunStatus,
    last_error AS lastError
  FROM leaderboard_schedule
`;

function mapScheduleRow(row: ScheduleRow): LeaderboardSchedule {
  return {
    ...row,
    frequency: 'weekly',
    dayOfWeek: row.dayOfWeek as LeaderboardSchedule['dayOfWeek'],
    format: row.format as LeaderboardSchedule['format'],
    lastRunStatus: row.lastRunStatus as ScheduleRunStatus | null,
    enabled: row.enabled === 1,
  };
}

function normalizeGuildId(value: string): string {
  return normalizeIdentifier(value, 'Guild ID');
}

function normalizeIdentifier(value: string, label: string): string {
  const normalized = value.trim();

  if (!normalized || normalized.length > 64) {
    throw new RangeError(`${label} must contain between 1 and 64 characters.`);
  }

  return normalized;
}

function validateTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new RangeError(`${label} must be a valid timestamp.`);
  }
}
