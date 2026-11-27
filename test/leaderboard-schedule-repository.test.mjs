import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../dist/database/database.js';
import { LeaderboardScheduleRepository } from '../dist/database/leaderboard-schedule-repository.js';
import { PlayerRepository } from '../dist/database/player-repository.js';
import { ProfileCacheRepository } from '../dist/database/profile-cache-repository.js';

const scheduleInput = {
  guildId: 'guild-1',
  channelId: 'channel-1',
  dayOfWeek: 0,
  localTime: '18:30',
  timeZone: 'America/New_York',
  format: 'rich',
  actorDiscordUserId: 'admin-1',
};

function withRepository(callback) {
  const database = openDatabase(':memory:');

  try {
    callback(new LeaderboardScheduleRepository(database), database);
  } finally {
    database.close();
  }
}

test('creates a schema-version-3 database with the schedule table', () => {
  withRepository((_schedules, database) => {
    assert.equal(database.pragma('user_version', { simple: true }), 3);
    const table = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'leaderboard_schedule'",
      )
      .get();
    assert.ok(table);
  });
});

test('saves and retrieves a weekly schedule', () => {
  withRepository((schedules) => {
    const saved = schedules.save(scheduleInput, '2026-11-26T18:00:00.000Z');

    assert.equal(saved.guildId, 'guild-1');
    assert.equal(saved.channelId, 'channel-1');
    assert.equal(saved.frequency, 'weekly');
    assert.equal(saved.dayOfWeek, 0);
    assert.equal(saved.localTime, '18:30');
    assert.equal(saved.timeZone, 'America/New_York');
    assert.equal(saved.format, 'rich');
    assert.equal(saved.enabled, true);
    assert.equal(saved.createdByDiscordUserId, 'admin-1');
    assert.equal(saved.updatedByDiscordUserId, 'admin-1');
    assert.equal(schedules.get('guild-1')?.id, saved.id);
  });
});

test('saving again replaces the guild schedule instead of creating another row', () => {
  withRepository((schedules, database) => {
    const original = schedules.save(scheduleInput, '2026-11-26T18:00:00.000Z');
    schedules.recordRun('guild-1', 'success', null, '2026-11-26T18:30:00.000Z');

    const updated = schedules.save(
      {
        ...scheduleInput,
        channelId: 'channel-2',
        dayOfWeek: 3,
        localTime: '19:15',
        timeZone: 'America/Chicago',
        format: 'compact',
        actorDiscordUserId: 'admin-2',
      },
      '2026-11-27T12:00:00.000Z',
    );

    assert.equal(updated.id, original.id);
    assert.equal(updated.channelId, 'channel-2');
    assert.equal(updated.dayOfWeek, 3);
    assert.equal(updated.localTime, '19:15');
    assert.equal(updated.timeZone, 'America/Chicago');
    assert.equal(updated.format, 'compact');
    assert.equal(updated.createdByDiscordUserId, 'admin-1');
    assert.equal(updated.updatedByDiscordUserId, 'admin-2');
    assert.equal(updated.lastRunStatus, 'success');
    assert.equal(updated.lastRunAt, '2026-11-26T18:30:00.000Z');
    const count = database
      .prepare('SELECT COUNT(*) AS count FROM leaderboard_schedule')
      .get().count;
    assert.equal(count, 1);
  });
});

test('pause and resume update the enabled state', () => {
  withRepository((schedules) => {
    schedules.save(scheduleInput);
    assert.equal(schedules.listEnabled().length, 1);

    const paused = schedules.setEnabled('guild-1', false, 'admin-2');
    assert.equal(paused?.enabled, false);
    assert.equal(schedules.listEnabled().length, 0);

    const resumed = schedules.setEnabled('guild-1', true, 'admin-2');
    assert.equal(resumed?.enabled, true);
    assert.equal(schedules.listEnabled().length, 1);
    assert.equal(schedules.setEnabled('unknown-guild', true, 'admin-2'), undefined);
  });
});

test('records successful and failed executions', () => {
  withRepository((schedules) => {
    schedules.save(scheduleInput);

    assert.equal(
      schedules.recordRun(
        'guild-1',
        'failure',
        '  Discord channel is unavailable  ',
        '2026-11-27T00:00:00.000Z',
      ),
      true,
    );
    const failed = schedules.get('guild-1');
    assert.equal(failed?.lastRunStatus, 'failure');
    assert.equal(failed?.lastError, 'Discord channel is unavailable');

    schedules.recordRun('guild-1', 'success', 'ignored error', '2026-11-28T00:00:00.000Z');
    const succeeded = schedules.get('guild-1');
    assert.equal(succeeded?.lastRunStatus, 'success');
    assert.equal(succeeded?.lastError, null);
    assert.equal(succeeded?.lastRunAt, '2026-11-28T00:00:00.000Z');
  });
});

test('removes a schedule and reports whether one existed', () => {
  withRepository((schedules) => {
    schedules.save(scheduleInput);
    assert.equal(schedules.remove('guild-1'), true);
    assert.equal(schedules.remove('guild-1'), false);
    assert.equal(schedules.get('guild-1'), undefined);
  });
});

test('enforces one schedule per guild while allowing different guilds', () => {
  withRepository((schedules, database) => {
    schedules.save(scheduleInput);
    schedules.save({ ...scheduleInput, guildId: 'guild-2' });

    const count = database
      .prepare('SELECT COUNT(*) AS count FROM leaderboard_schedule')
      .get().count;
    assert.equal(count, 2);
    assert.equal(schedules.listEnabled().length, 2);
  });
});

test('upgrades a version-2 database without losing players or cached profiles', () => {
  const directory = mkdtempSync(join(tmpdir(), 'slippi-schedule-migration-'));
  const databasePath = join(directory, 'bot.sqlite');

  try {
    const oldDatabase = new Database(databasePath);
    oldDatabase.exec(`
      CREATE TABLE players (
        guild_id TEXT NOT NULL,
        connect_code TEXT NOT NULL COLLATE NOCASE,
        added_by_discord_user_id TEXT NOT NULL,
        added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        PRIMARY KEY (guild_id, connect_code)
      ) WITHOUT ROWID;
      CREATE TABLE slippi_profiles (
        connect_code TEXT NOT NULL COLLATE NOCASE PRIMARY KEY,
        display_name TEXT NOT NULL,
        rating REAL,
        rating_update_count INTEGER,
        wins INTEGER,
        losses INTEGER,
        daily_global_placement INTEGER,
        daily_regional_placement INTEGER,
        continent TEXT,
        fetched_at TEXT NOT NULL
      ) WITHOUT ROWID;
    `);
    oldDatabase
      .prepare(
        `
      INSERT INTO players (guild_id, connect_code, added_by_discord_user_id)
      VALUES (?, ?, ?)
    `,
      )
      .run('guild-1', 'MANG#0', 'user-1');
    oldDatabase
      .prepare(
        `
      INSERT INTO slippi_profiles (
        connect_code, display_name, rating, rating_update_count, wins, losses,
        daily_global_placement, daily_regional_placement, continent, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        'MANG#0',
        'Mango',
        2300,
        200,
        120,
        80,
        147,
        39,
        'North America',
        '2026-11-26T00:00:00.000Z',
      );
    oldDatabase.pragma('user_version = 2');
    oldDatabase.close();

    const upgraded = openDatabase(databasePath);
    try {
      assert.equal(upgraded.pragma('user_version', { simple: true }), 3);
      assert.equal(new PlayerRepository(upgraded).get('guild-1', 'MANG#0')?.connectCode, 'MANG#0');
      assert.equal(new ProfileCacheRepository(upgraded).get('MANG#0')?.displayName, 'Mango');
      assert.equal(new LeaderboardScheduleRepository(upgraded).get('guild-1'), undefined);
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects invalid schedule values before they reach SQLite', () => {
  withRepository((schedules) => {
    assert.throws(() => schedules.save({ ...scheduleInput, localTime: '25:00' }), /24-hour HH:MM/);
    assert.throws(
      () => schedules.save({ ...scheduleInput, timeZone: 'Invalid/Timezone' }),
      /Invalid IANA/,
    );
    assert.throws(
      () => schedules.save({ ...scheduleInput, dayOfWeek: 7 }),
      /day must be an integer/,
    );
    assert.throws(() => schedules.save({ ...scheduleInput, format: 'unknown' }), /format must be/);
  });
});
