import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

export type SqliteDatabase = InstanceType<typeof Database>;

const CURRENT_SCHEMA_VERSION = 2;

/**
 * Open the application's SQLite database, configure safe defaults, and apply
 * any schema migrations that have not yet run.
 */
export function openDatabase(databasePath: string): SqliteDatabase {
  const normalizedPath = databasePath.trim();

  if (!normalizedPath) {
    throw new Error('Database path must not be empty.');
  }

  // The special in-memory database does not need a parent directory.
  if (normalizedPath !== ':memory:') {
    mkdirSync(dirname(resolve(normalizedPath)), { recursive: true });
  }

  const database = new Database(normalizedPath);

  try {
    database.pragma('foreign_keys = ON');
    database.pragma('busy_timeout = 5000');
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = NORMAL');

    migrate(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function migrate(database: SqliteDatabase): void {
  let currentVersion = Number(database.pragma('user_version', { simple: true }));

  if (!Number.isInteger(currentVersion) || currentVersion < 0) {
    throw new Error(`Invalid SQLite schema version: ${currentVersion}`);
  }

  if (currentVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${currentVersion} is newer than this application ` +
        `supports (${CURRENT_SCHEMA_VERSION}).`,
    );
  }

  if (currentVersion < 1) {
    const migration = database.transaction(() => {
      database.exec(`
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

      database.pragma('user_version = 1');
    });

    migration();
    currentVersion = 1;
  }

  if (currentVersion < 2) {
    const migration = database.transaction(() => {
      database.exec(`
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
          fetched_at TEXT NOT NULL,
          CHECK (length(trim(connect_code)) BETWEEN 3 AND 32),
          CHECK (length(trim(display_name)) BETWEEN 1 AND 128),
          CHECK (rating IS NULL OR rating >= 0),
          CHECK (rating_update_count IS NULL OR rating_update_count >= 0),
          CHECK (wins IS NULL OR wins >= 0),
          CHECK (losses IS NULL OR losses >= 0),
          CHECK (daily_global_placement IS NULL OR daily_global_placement >= 1),
          CHECK (daily_regional_placement IS NULL OR daily_regional_placement >= 1)
        ) WITHOUT ROWID;
      `);

      database.pragma('user_version = 2');
    });

    migration();
    currentVersion = 2;
  }
}
