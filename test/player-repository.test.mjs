import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../dist/database/database.js';
import { PlayerRepository } from '../dist/database/player-repository.js';

function withRepository(callback) {
  const database = openDatabase(':memory:');

  try {
    callback(new PlayerRepository(database));
  } finally {
    database.close();
  }
}

test('adds a normalized player and records who added them', () => {
  withRepository((players) => {
    const result = players.add('guild-1', '  abcd#123  ', 'user-1');

    assert.equal(result.status, 'added');
    assert.equal(result.player.guildId, 'guild-1');
    assert.equal(result.player.connectCode, 'ABCD#123');
    assert.equal(result.player.addedByDiscordUserId, 'user-1');
    assert.match(result.player.addedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  });
});

test('prevents duplicate Connect Codes within a guild', () => {
  withRepository((players) => {
    players.add('guild-1', 'ABCD#123', 'user-1');
    const result = players.add('guild-1', 'abcd#123', 'user-2');

    assert.equal(result.status, 'already-registered');
    assert.equal(result.player.addedByDiscordUserId, 'user-1');
    assert.equal(players.list('guild-1').length, 1);
  });
});

test('keeps each guild registration list isolated', () => {
  withRepository((players) => {
    players.add('guild-1', 'ABCD#123', 'user-1');
    players.add('guild-2', 'ABCD#123', 'user-2');

    assert.equal(players.list('guild-1').length, 1);
    assert.equal(players.list('guild-2').length, 1);
    assert.equal(players.list('guild-1')[0]?.addedByDiscordUserId, 'user-1');
    assert.equal(players.list('guild-2')[0]?.addedByDiscordUserId, 'user-2');
  });
});

test('returns undefined for an unknown player', () => {
  withRepository((players) => {
    assert.equal(players.get('guild-1', 'ABCD#123'), undefined);
  });
});

test('removes a player and reports whether a row was deleted', () => {
  withRepository((players) => {
    players.add('guild-1', 'ABCD#123', 'user-1');

    assert.equal(players.remove('guild-1', 'ABCD#123'), true);
    assert.equal(players.remove('guild-1', 'ABCD#123'), false);
    assert.equal(players.list('guild-1').length, 0);
  });
});

test('rejects blank Connect Codes and identifiers', () => {
  withRepository((players) => {
    assert.throws(() => players.add('guild-1', '   ', 'user-1'), /Connect Code/);
    assert.throws(() => players.add(' ', 'ABCD#123', 'user-1'), /Guild ID/);
    assert.throws(() => players.add('guild-1', 'ABCD#123', ' '), /Discord user ID/);
  });
});

test('rejects a blank database path', () => {
  assert.throws(() => openDatabase('  '), /Database path/);
});

test('rejects blank or oversized Connect Codes for lookups and removals', () => {
  withRepository((players) => {
    assert.throws(() => players.get('guild-1', ' '), /Connect Code/);
    assert.throws(() => players.remove('guild-1', ' '), /Connect Code/);
    assert.throws(() => players.remove('guild-1', 'A'.repeat(33)), /Connect Code/);
  });
});
