import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCompactLeaderboardPage,
  formatRichLeaderboardPage,
} from '../dist/presentation/leaderboard-format.js';
import { getRankEmojiTag } from '../dist/presentation/rank-emojis.js';

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

function snapshot(entries, overrides = {}) {
  return {
    entries,
    registeredPlayerCount: entries.length,
    refreshedProfileCount: entries.length,
    notFoundProfileCount: 0,
    staleProfileCount: 0,
    missingProfileCount: 0,
    apiUnavailable: false,
    ...overrides,
  };
}

test('rich leaderboard shows rank emoji, clickable profile, Connect Code, rating, and record', () => {
  const text = formatRichLeaderboardPage(snapshot([entry(1)]), {
    pageIndex: 0,
    pageCount: 1,
    applicationEmojiTags: new Map([['rank_gold_1', '<:rank_gold_1:123456>']]),
  });

  assert.match(text, /<:rank_gold_1:123456>/);
  assert.match(text, /\[Player 1\]\(https:\/\/slippi\.gg\/user\/code-1\)/);
  assert.match(text, /`CODE#1`/);
  assert.match(text, /Gold 1/);
  assert.match(text, /1,501\.0 rating/);
  assert.match(text, /10W \/ 5L/);
});

test('rich leaderboard safely escapes profile names before inserting them into a Markdown link', () => {
  const maliciousName = 'Bad](https://bad.io) @everyone';
  const text = formatRichLeaderboardPage(
    snapshot([entry(1, { profile: { ...entry(1).profile, displayName: maliciousName } })]),
    { pageIndex: 0, pageCount: 1 },
  );

  assert.ok(text.includes('Bad\\]\\(https://bad.io\\)'));
  assert.match(text, /@every/);
});

test('compact leaderboard renders a fixed-width text-only table', () => {
  const text = formatCompactLeaderboardPage(snapshot([entry(1)]), {
    pageIndex: 0,
    pageCount: 1,
  });

  assert.match(text, /```text/);
  assert.match(text, /PLAYER\s+RANK\s+RATING\s+W\/L/);
  assert.match(text, /Player 1/);
  assert.match(text, /Gold 1/);
  assert.match(text, /CODE#1/);
  assert.match(text, /1,501\.0/);
  assert.match(text, /10\/5/);
  assert.match(text, /↳ CODE#1/);
  assert.doesNotMatch(text, /<:rank_/);

  const tableLines = text.split('```text\n')[1].split('\n```')[0].split('\n');
  const dataLines = tableLines.filter((line) => /^\s*\d{2,3}\s/.test(line));
  assert.ok(dataLines.every((line) => line.length === tableLines[0].length));
});

test('both leaderboard formats page twenty entries at a time', () => {
  const data = snapshot(Array.from({ length: 21 }, (_, index) => entry(index + 1)));
  const firstRichPage = formatRichLeaderboardPage(data, { pageIndex: 0, pageCount: 2 });
  const secondRichPage = formatRichLeaderboardPage(data, { pageIndex: 1, pageCount: 2 });
  const firstCompactPage = formatCompactLeaderboardPage(data, { pageIndex: 0, pageCount: 2 });
  const secondCompactPage = formatCompactLeaderboardPage(data, { pageIndex: 1, pageCount: 2 });

  assert.match(firstRichPage, /Page 1 of 2/);
  assert.match(secondRichPage, /Page 2 of 2/);
  assert.match(firstRichPage, /Player 20/);
  assert.doesNotMatch(firstRichPage, /Player 21/);
  assert.match(secondRichPage, /Player 21/);
  assert.match(firstCompactPage, /Page 1 of 2/);
  assert.doesNotMatch(firstCompactPage, /Player 21/);
  assert.match(secondCompactPage, /Player 21/);
});

test('communicates cached data and Slippi outage state in both formats', () => {
  const data = snapshot([entry(1)], {
    refreshedProfileCount: 0,
    staleProfileCount: 1,
    apiUnavailable: true,
  });

  const rich = formatRichLeaderboardPage(data, { pageIndex: 0, pageCount: 1 });
  const compact = formatCompactLeaderboardPage(data, { pageIndex: 0, pageCount: 1 });

  assert.match(rich, /Slippi is temporarily unavailable/);
  assert.match(compact, /Slippi is temporarily unavailable/);
  assert.match(rich, /last successfully cached profile data/);
  assert.match(compact, /last successfully cached profiles where available/);
});

test('pending and unranked states use distinct application rank badges', () => {
  const emojis = new Map([
    ['rank_pending', '<:rank_pending:111>'],
    ['rank_unranked', '<:rank_unranked:222>'],
  ]);

  assert.equal(getRankEmojiTag('Pending', emojis), '<:rank_pending:111>');
  assert.equal(getRankEmojiTag('Unranked', emojis), '<:rank_unranked:222>');
});
