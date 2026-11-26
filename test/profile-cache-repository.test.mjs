import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../dist/database/database.js';
import { ProfileCacheRepository } from '../dist/database/profile-cache-repository.js';
import { PlayerRepository } from '../dist/database/player-repository.js';

const profile = {
  connectCode: 'MANG#0',
  displayName: 'Mango',
  rating: 2310.5,
  ratingUpdateCount: 200,
  wins: 120,
  losses: 80,
  dailyGlobalPlacement: 147,
  dailyRegionalPlacement: 39,
  continent: 'North America',
};

function withRepository(callback) {
  const database = openDatabase(':memory:');

  try {
    callback(new ProfileCacheRepository(database), database);
  } finally {
    database.close();
  }
}

test('database migrates to schema version 2', () => {
  withRepository((_profiles, database) => {
    assert.equal(database.pragma('user_version', { simple: true }), 2);
  });
});

test('upgrades a version-1 database without losing registered players', () => {
  const directory = mkdtempSync(join(tmpdir(), 'slippi-db-migration-'));
  const databasePath = join(directory, 'bot.sqlite');

  try {
    const oldDatabase = new Database(databasePath);
    oldDatabase.exec(`
      CREATE TABLE players (
        guild_id TEXT NOT NULL,
        connect_code TEXT NOT NULL COLLATE NOCASE,
        added_by_discord_user_id TEXT NOT NULL,
        added_at TEXT NOT NULL DEFAULT (
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ),
        PRIMARY KEY (guild_id, connect_code),
        CHECK (length(trim(guild_id)) BETWEEN 1 AND 64),
        CHECK (length(trim(connect_code)) BETWEEN 1 AND 32),
        CHECK (length(trim(added_by_discord_user_id)) BETWEEN 1 AND 64)
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
    oldDatabase.pragma('user_version = 1');
    oldDatabase.close();

    const upgradedDatabase = openDatabase(databasePath);

    try {
      assert.equal(upgradedDatabase.pragma('user_version', { simple: true }), 2);
      assert.equal(
        new PlayerRepository(upgradedDatabase).get('guild-1', 'MANG#0')?.connectCode,
        'MANG#0',
      );
      assert.equal(new ProfileCacheRepository(upgradedDatabase).get('MANG#0'), undefined);
    } finally {
      upgradedDatabase.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('stores and retrieves a normalized Slippi profile', () => {
  withRepository((profiles) => {
    const saved = profiles.upsert({ ...profile, connectCode: 'mang 0' });

    assert.equal(saved.connectCode, 'MANG#0');
    assert.equal(saved.displayName, 'Mango');
    assert.equal(saved.rating, 2310.5);
    assert.equal(saved.dailyGlobalPlacement, 147);
    assert.match(saved.fetchedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    assert.deepEqual(profiles.get('MANG#0'), saved);
  });
});

test('upsert replaces profile data and refresh timestamp', () => {
  withRepository((profiles) => {
    profiles.upsert(profile, '2026-01-01T00:00:00.000Z');
    const updated = profiles.upsert(
      { ...profile, displayName: 'Mango Updated', rating: 2400 },
      '2026-01-02T00:00:00.000Z',
    );

    assert.equal(updated.displayName, 'Mango Updated');
    assert.equal(updated.rating, 2400);
    assert.equal(updated.fetchedAt, '2026-01-02T00:00:00.000Z');
    assert.equal(profiles.getMany(['MANG#0', 'mang#0']).length, 1);
  });
});

test('returns undefined for a profile not yet cached', () => {
  withRepository((profiles) => {
    assert.equal(profiles.get('MISS#123'), undefined);
  });
});

test('rejects invalid Connect Codes and timestamps', () => {
  withRepository((profiles) => {
    assert.throws(() => profiles.upsert({ ...profile, connectCode: 'not-a-code' }), /Connect Code/);
    assert.throws(() => profiles.upsert(profile, 'not-a-date'), /timestamp/);
  });
});
