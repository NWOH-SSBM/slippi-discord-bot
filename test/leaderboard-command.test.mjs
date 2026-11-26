import test from 'node:test';
import assert from 'node:assert/strict';
import { createPages } from '../dist/commands/leaderboard.js';

function entry(position, overrides = {}) {
  const connectCode = `CODE#${position}`;
  return {
    registration: {
      guildId: 'guild-1',
      connectCode,
      addedByDiscordUserId: 'user-1',
      addedAt: '2026-01-01T00:00:00.000Z',
    },
    profile: {
      connectCode,
      displayName: `Player ${position}`,
      rating: 1500 + position,
      ratingUpdateCount: 10,
      wins: 10,
      losses: 5,
      dailyGlobalPlacement: null,
      dailyRegionalPlacement: null,
      continent: 'North America',
      fetchedAt: '2026-11-25T10:00:00.000Z',
    },
    rank: 'Gold 1',
    ...overrides,
  };
}

test('creates one leaderboard embed for up to twenty players', () => {
  const pages = createPages({
    entries: [entry(1), entry(2)],
    registeredPlayerCount: 2,
    refreshedProfileCount: 2,
    notFoundProfileCount: 0,
    staleProfileCount: 0,
    missingProfileCount: 0,
    apiUnavailable: false,
  });

  assert.equal(pages.length, 1);
  assert.equal(pages[0].data.title, 'Slippi Leaderboard');
  assert.match(pages[0].data.description, /Player 1/);
  assert.match(pages[0].data.description, /Gold 1/);
  assert.match(pages[0].data.description, /1,501\.0/);
});

test('splits larger leaderboards into pages of twenty', () => {
  const pages = createPages({
    entries: Array.from({ length: 21 }, (_, index) => entry(index + 1)),
    registeredPlayerCount: 21,
    refreshedProfileCount: 21,
    notFoundProfileCount: 0,
    staleProfileCount: 0,
    missingProfileCount: 0,
    apiUnavailable: false,
  });

  assert.equal(pages.length, 2);
  assert.match(pages[0].data.footer.text, /Page 1 of 2/);
  assert.match(pages[1].data.footer.text, /Page 2 of 2/);
  assert.match(pages[0].data.description, /Player 20/);
  assert.doesNotMatch(pages[0].data.description, /Player 21/);
  assert.match(pages[1].data.description, /Player 21/);
});

test('communicates cached data and Slippi outage state', () => {
  const pages = createPages({
    entries: [entry(1)],
    registeredPlayerCount: 1,
    refreshedProfileCount: 0,
    notFoundProfileCount: 0,
    staleProfileCount: 1,
    missingProfileCount: 0,
    apiUnavailable: true,
  });

  assert.match(pages[0].data.description, /Slippi is temporarily unavailable/);
  assert.match(pages[0].data.description, /last successfully cached/);
});

test('formats the rank prominently and shows stale-cache status', () => {
  const pages = createPages({
    entries: [entry(1)],
    registeredPlayerCount: 1,
    refreshedProfileCount: 0,
    notFoundProfileCount: 0,
    staleProfileCount: 1,
    missingProfileCount: 0,
    apiUnavailable: false,
  });

  assert.match(pages[0].data.description, /\*\*Gold 1\*\*/);
  assert.match(pages[0].data.description, /older than the refresh interval/);
});
