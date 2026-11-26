import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRANDMASTER_MINIMUM_RATING,
  PLACEMENT_GAME_COUNT,
  RANK_THRESHOLDS,
  resolveRank,
} from '../dist/domain/rank.js';

function profile(overrides = {}) {
  return {
    rating: 1500,
    wins: 5,
    losses: 0,
    dailyGlobalPlacement: null,
    ...overrides,
  };
}

test('maps every static rank threshold to the expected rank', () => {
  for (const threshold of RANK_THRESHOLDS) {
    assert.equal(
      resolveRank(profile({ rating: threshold.minimumRating })),
      threshold.name,
      `Expected ${threshold.minimumRating} to map to ${threshold.name}`,
    );
  }
});

test('assigns the rank immediately below a threshold when just under it', () => {
  for (let index = 1; index < RANK_THRESHOLDS.length; index += 1) {
    const previous = RANK_THRESHOLDS[index - 1];
    const current = RANK_THRESHOLDS[index];

    assert.ok(previous);
    assert.ok(current);
    assert.equal(resolveRank(profile({ rating: current.minimumRating - 0.01 })), previous.name);
  }
});

test('returns Unranked when the profile has no rating or no ranked games', () => {
  assert.equal(resolveRank(profile({ rating: null, wins: 0, losses: 0 })), 'Unranked');
  assert.equal(resolveRank(profile({ rating: 1100, wins: 0, losses: 0 })), 'Unranked');
});

test('returns Pending until five total ranked games are recorded', () => {
  assert.equal(
    resolveRank(profile({ rating: 1500, wins: 2, losses: PLACEMENT_GAME_COUNT - 3 })),
    'Pending',
  );
  assert.equal(resolveRank(profile({ rating: 1500, wins: 4, losses: 0 })), 'Pending');
  assert.equal(resolveRank(profile({ rating: 1500, wins: 5, losses: 0 })), 'Gold 1');
});

test('requires the upstream global-placement signal for Grandmaster', () => {
  assert.equal(
    resolveRank(profile({ rating: GRANDMASTER_MINIMUM_RATING, dailyGlobalPlacement: null })),
    'Master 1',
  );
  assert.equal(
    resolveRank(profile({ rating: GRANDMASTER_MINIMUM_RATING, dailyGlobalPlacement: 300 })),
    'Grandmaster',
  );
});

test('Grandmaster takes precedence over the higher static Master tiers', () => {
  assert.equal(resolveRank(profile({ rating: 2400, dailyGlobalPlacement: 12 })), 'Grandmaster');
});

test('does not infer Grandmaster from missing or invalid global placement', () => {
  assert.equal(resolveRank(profile({ rating: 2300, dailyGlobalPlacement: undefined })), 'Master 2');
  assert.equal(resolveRank(profile({ rating: 2300, dailyGlobalPlacement: 0 })), 'Master 2');
});
