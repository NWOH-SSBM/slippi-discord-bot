import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatScheduledCompactLeaderboard,
  formatScheduledRichLeaderboard,
} from '../dist/presentation/leaderboard-format.js';

function createSnapshot(count, overrides = {}) {
  const entries = Array.from({ length: count }, (_, index) => ({
    registration: {
      guildId: 'guild-1',
      connectCode: `PLAY#${String(index).padStart(3, '0')}`,
      addedByDiscordUserId: 'user-1',
      addedAt: '2026-11-26T00:00:00.000Z',
    },
    profile: {
      connectCode: `PLAY#${String(index).padStart(3, '0')}`,
      displayName: `Player ${index + 1}`,
      rating: 1800 + index,
      ratingUpdateCount: 20,
      wins: 10,
      losses: 5,
      dailyGlobalPlacement: null,
      dailyRegionalPlacement: null,
      continent: 'North America',
      fetchedAt: '2026-11-26T12:00:00.000Z',
    },
    rank: 'Platinum 1',
  }));

  return {
    entries,
    registeredPlayerCount: count,
    refreshedProfileCount: 0,
    notFoundProfileCount: 0,
    staleProfileCount: 0,
    missingProfileCount: 0,
    apiUnavailable: false,
    ...overrides,
  };
}

test('scheduled rich format is static and includes a top-20 summary when roster is larger', () => {
  const snapshot = createSnapshot(27);
  const text = formatScheduledRichLeaderboard(snapshot, new Map());

  assert.match(text, /Slippi Leaderboard/);
  assert.match(text, /Player 1/);
  assert.match(text, /Player 20/);
  assert.doesNotMatch(text, /Player 21/);
  assert.match(text, /showing top 20 of 27 registered players/i);
  assert.doesNotMatch(text, /Page 1 of/);
});

test('scheduled compact format is a text table without pagination controls', () => {
  const text = formatScheduledCompactLeaderboard(createSnapshot(23));

  assert.match(text, /```text/);
  assert.match(text, /PLAYER/);
  assert.match(text, /PLAY#000/);
  assert.match(text, /PLAY#019/);
  assert.doesNotMatch(text, /PLAY#020/);
  assert.match(text, /top 20 of 23 registered players/i);
  assert.doesNotMatch(text, /Page 1 of/);
});

test('scheduled formats retain a stale-data warning', () => {
  const snapshot = createSnapshot(2, { apiUnavailable: true, staleProfileCount: 2 });

  assert.match(
    formatScheduledRichLeaderboard(snapshot, new Map()),
    /Slippi is temporarily unavailable/i,
  );
  assert.match(formatScheduledCompactLeaderboard(snapshot), /Slippi is temporarily unavailable/i);
});

test('scheduled formats explain an empty roster instead of publishing an empty table', () => {
  const snapshot = createSnapshot(0);

  assert.match(
    formatScheduledRichLeaderboard(snapshot, new Map()),
    /No players are registered yet/i,
  );
  assert.match(formatScheduledCompactLeaderboard(snapshot), /No players are registered yet/i);
});
