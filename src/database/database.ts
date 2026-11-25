import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

export type SqliteDatabase = InstanceType<typeof Database>;

const CURRENT_SCHEMA_VERSION = 1;

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
  const currentVersion = Number(database.pragma('user_version', { simple: true }));

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
  }
}
