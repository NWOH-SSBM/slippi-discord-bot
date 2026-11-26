import test from 'node:test';
import assert from 'node:assert/strict';
import { LeaderboardSessionStore } from '../dist/services/leaderboard-session-store.js';
import {
  createLeaderboardButtonCustomId,
  isLeaderboardButtonCustomId,
  parseLeaderboardButtonCustomId,
} from '../dist/domain/leaderboard-pagination.js';

function snapshot(playerCount) {
  return {
    entries: Array.from({ length: playerCount }, (_, index) => ({ index })),
    registeredPlayerCount: playerCount,
    refreshedProfileCount: 0,
    notFoundProfileCount: 0,
    staleProfileCount: 0,
    missingProfileCount: 0,
    apiUnavailable: false,
  };
}

test('creates a paginated session only when the result spans multiple pages', () => {
  let id = 0;
  const sessions = new LeaderboardSessionStore({ createId: () => `session-${++id}` });

  assert.equal(sessions.create('user-1', 'rich', snapshot(20)), undefined);

  const session = sessions.create('user-1', 'rich', snapshot(21));
  assert.equal(session.id, 'session-1');
  assert.equal(session.ownerUserId, 'user-1');
  assert.equal(session.format, 'rich');
  assert.equal(session.pageCount, 2);
  assert.equal(session.pageIndex, 0);
});

test('updates page state and slides the inactivity expiry forward', () => {
  let now = 1_000;
  const sessions = new LeaderboardSessionStore({
    ttlMs: 5_000,
    now: () => now,
    createId: () => 'session-1',
  });

  sessions.create('user-1', 'compact', snapshot(41));
  now = 4_000;
  const page = sessions.setPage('session-1', 2);

  assert.equal(page.pageIndex, 2);
  assert.equal(page.expiresAt, 9_000);
});

test('expired sessions are removed and cannot be retrieved', () => {
  let now = 1_000;
  const sessions = new LeaderboardSessionStore({
    ttlMs: 1_000,
    now: () => now,
    createId: () => 'session-1',
  });

  sessions.create('user-1', 'rich', snapshot(21));
  now = 2_000;

  assert.equal(sessions.get('session-1'), undefined);
  assert.equal(sessions.size, 0);
});

test('enforces a maximum number of in-memory snapshots', () => {
  let id = 0;
  const sessions = new LeaderboardSessionStore({
    maxSessions: 2,
    createId: () => `session-${++id}`,
  });

  sessions.create('user-1', 'rich', snapshot(21));
  sessions.create('user-1', 'rich', snapshot(22));
  sessions.create('user-1', 'rich', snapshot(23));

  assert.equal(sessions.size, 2);
  assert.equal(sessions.get('session-1'), undefined);
  assert.ok(sessions.get('session-2'));
  assert.ok(sessions.get('session-3'));
});

test('rejects page indexes outside the snapshot bounds', () => {
  const sessions = new LeaderboardSessionStore({ createId: () => 'session-1' });
  sessions.create('user-1', 'rich', snapshot(21));

  assert.throws(() => sessions.setPage('session-1', 2), /outside the session/);
});

test('can invalidate a session when Discord rejects a message update', () => {
  const sessions = new LeaderboardSessionStore({ createId: () => 'session-1' });
  sessions.create('user-1', 'rich', snapshot(21));

  assert.equal(sessions.delete('session-1'), true);
  assert.equal(sessions.get('session-1'), undefined);
  assert.equal(sessions.delete('session-1'), false);
});

test('builds and parses stable button IDs and recognizes legacy collector buttons', () => {
  const customId = createLeaderboardButtonCustomId('session-123', 'next');

  assert.equal(customId, 'slippi-lb:session-123:next');
  assert.deepEqual(parseLeaderboardButtonCustomId(customId), {
    sessionId: 'session-123',
    action: 'next',
  });
  assert.equal(parseLeaderboardButtonCustomId('slippi-lb:session-123:invalid'), undefined);
  assert.equal(parseLeaderboardButtonCustomId('slippi-lb:session-123:next:extra'), undefined);
  assert.equal(isLeaderboardButtonCustomId(customId), true);
  assert.equal(isLeaderboardButtonCustomId('leaderboard:previous'), true);
  assert.equal(isLeaderboardButtonCustomId('unrelated:button'), false);
});
