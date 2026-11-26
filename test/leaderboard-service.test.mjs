import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../dist/database/database.js';
import { PlayerRepository } from '../dist/database/player-repository.js';
import { ProfileCacheRepository } from '../dist/database/profile-cache-repository.js';
import { LeaderboardService } from '../dist/services/leaderboard-service.js';
import { SlippiApiError } from '../dist/services/slippi-client.js';

function playerProfile(connectCode, overrides = {}) {
  return {
    connectCode,
    displayName: connectCode,
    rating: 1500,
    ratingUpdateCount: 10,
    wins: 5,
    losses: 0,
    dailyGlobalPlacement: null,
    dailyRegionalPlacement: null,
    continent: 'North America',
    ...overrides,
  };
}

async function withRepositories(callback) {
  const database = openDatabase(':memory:');

  try {
    await callback(new PlayerRepository(database), new ProfileCacheRepository(database));
  } finally {
    database.close();
  }
}

test('sorts cached profiles by rank, then rating, then display name', async () => {
  await withRepositories(async (players, profiles) => {
    players.add('guild-1', 'LOW#1', 'user-1');
    players.add('guild-1', 'HIGH#1', 'user-1');
    players.add('guild-1', 'GM#1', 'user-1');

    profiles.upsert(playerProfile('LOW#1', { rating: 1400, displayName: 'Low' }));
    profiles.upsert(playerProfile('HIGH#1', { rating: 1600, displayName: 'High' }));
    profiles.upsert(
      playerProfile('GM#1', { rating: 2200, dailyGlobalPlacement: 125, displayName: 'GM' }),
    );

    const service = new LeaderboardService(
      players,
      profiles,
      {
        getPlayer: async () => {
          throw new Error('Fresh profiles should not be requested.');
        },
      },
      { profileCacheTtlMs: Number.MAX_SAFE_INTEGER },
    );

    const snapshot = await service.getLeaderboard('guild-1');
    assert.deepEqual(
      snapshot.entries.map((entry) => entry.registration.connectCode),
      ['GM#1', 'HIGH#1', 'LOW#1'],
    );
  });
});

test('refreshes stale profiles and persists the latest successful response', async () => {
  await withRepositories(async (players, profiles) => {
    players.add('guild-1', 'ABCD#123', 'user-1');
    profiles.upsert(
      playerProfile('ABCD#123', { displayName: 'Old Name', rating: 1400 }),
      '2025-01-01T00:00:00.000Z',
    );

    let lookupCount = 0;
    const service = new LeaderboardService(
      players,
      profiles,
      {
        getPlayer: async (code) => {
          lookupCount += 1;
          return playerProfile(code, { displayName: 'New Name', rating: 1700 });
        },
      },
      { profileCacheTtlMs: 0 },
    );

    const snapshot = await service.getLeaderboard('guild-1');
    assert.equal(lookupCount, 1);
    assert.equal(snapshot.refreshedProfileCount, 1);
    assert.equal(snapshot.entries[0]?.profile?.displayName, 'New Name');
    assert.equal(profiles.get('ABCD#123')?.rating, 1700);
  });
});

test('keeps the last successful cache and roster intact during Slippi outage', async () => {
  await withRepositories(async (players, profiles) => {
    players.add('guild-1', 'ABCD#123', 'user-1');
    profiles.upsert(
      playerProfile('ABCD#123', { displayName: 'Cached Player', rating: 1800 }),
      '2025-01-01T00:00:00.000Z',
    );

    const service = new LeaderboardService(
      players,
      profiles,
      {
        getPlayer: async () => {
          throw new SlippiApiError('Slippi is unavailable.', 503);
        },
      },
      { profileCacheTtlMs: 0 },
    );

    const snapshot = await service.getLeaderboard('guild-1');
    assert.equal(snapshot.apiUnavailable, true);
    assert.equal(snapshot.entries[0]?.profile?.displayName, 'Cached Player');
    assert.equal(profiles.get('ABCD#123')?.displayName, 'Cached Player');
    assert.equal(players.list('guild-1').length, 1);
  });
});

test('represents registrations without cached profiles as Awaiting data', async () => {
  await withRepositories(async (players, profiles) => {
    players.add('guild-1', 'ABCD#123', 'user-1');

    const service = new LeaderboardService(
      players,
      profiles,
      { getPlayer: async () => null },
      { profileCacheTtlMs: 0 },
    );

    const snapshot = await service.getLeaderboard('guild-1');
    assert.equal(snapshot.entries[0]?.rank, 'Awaiting data');
    assert.equal(snapshot.missingProfileCount, 1);
    assert.equal(snapshot.notFoundProfileCount, 1);
    assert.equal(snapshot.staleProfileCount, 0);
    assert.equal(players.list('guild-1').length, 1);
  });
});

test('reports an empty roster without querying Slippi', async () => {
  await withRepositories(async (players, profiles) => {
    let lookupCount = 0;
    const service = new LeaderboardService(players, profiles, {
      getPlayer: async () => {
        lookupCount += 1;
        return null;
      },
    });

    const snapshot = await service.getLeaderboard('guild-1');
    assert.equal(snapshot.registeredPlayerCount, 0);
    assert.equal(snapshot.entries.length, 0);
    assert.equal(lookupCount, 0);
  });
});
