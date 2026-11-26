import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags } from 'discord.js';
import { openDatabase } from '../dist/database/database.js';
import { PlayerRepository } from '../dist/database/player-repository.js';
import { ProfileCacheRepository } from '../dist/database/profile-cache-repository.js';
import { handlePlayerCommand } from '../dist/commands/player.js';
import { SlippiApiError } from '../dist/services/slippi-client.js';

async function withRepositories(callback) {
  const database = openDatabase(':memory:');

  try {
    await callback(new PlayerRepository(database), new ProfileCacheRepository(database));
  } finally {
    database.close();
  }
}

function createInteraction({ guildId = 'guild-1', userId = 'user-1', subcommand, connectCode }) {
  return {
    guildId,
    user: { id: userId },
    options: {
      getSubcommand: () => subcommand,
      getString: () => connectCode,
    },
    deferred: false,
    replied: false,
    response: undefined,
    async deferReply() {
      this.deferred = true;
    },
    async editReply(payload) {
      this.response = payload;
      this.replied = true;
      return payload;
    },
    async reply(payload) {
      this.response = payload;
      this.replied = true;
      return payload;
    },
  };
}

function createSlippiClient(
  implementation = async (connectCode) => ({
    connectCode,
    displayName: 'Test Player',
    rating: 1500,
    ratingUpdateCount: 15,
    wins: 10,
    losses: 5,
    dailyGlobalPlacement: null,
    dailyRegionalPlacement: null,
    continent: 'North America',
  }),
) {
  return { getPlayer: implementation };
}

test('player add verifies a profile and stores both registration and profile cache', async () => {
  await withRepositories(async (players, profiles) => {
    let lookupCode;
    const slippi = createSlippiClient(async (code) => {
      lookupCode = code;
      return {
        connectCode: code,
        displayName: 'Test Player',
        rating: 1500,
        ratingUpdateCount: 15,
        wins: 10,
        losses: 5,
        dailyGlobalPlacement: null,
        dailyRegionalPlacement: null,
        continent: 'North America',
      };
    });

    const interaction = createInteraction({
      subcommand: 'add',
      connectCode: ' abcd#123 ',
    });

    await handlePlayerCommand(interaction, players, profiles, slippi);

    assert.equal(lookupCode, 'ABCD#123');
    assert.equal(
      interaction.response.content,
      "Added ABCD#123 (Test Player) to this server's leaderboard.",
    );
    assert.equal(interaction.deferred, true);
    assert.equal(players.get('guild-1', 'ABCD#123')?.addedByDiscordUserId, 'user-1');
    assert.equal(profiles.get('ABCD#123')?.displayName, 'Test Player');
  });
});

test('player add rejects blank Connect Codes without a lookup', async () => {
  await withRepositories(async (players, profiles) => {
    let lookupCount = 0;
    const interaction = createInteraction({
      subcommand: 'add',
      connectCode: '   ',
    });

    await handlePlayerCommand(
      interaction,
      players,
      profiles,
      createSlippiClient(async () => {
        lookupCount += 1;
        return null;
      }),
    );

    assert.equal(lookupCount, 0);
    assert.match(interaction.response.content, /Invalid Connect Code/);
    assert.equal(players.list('guild-1').length, 0);
  });
});

test('player add does not store unknown profiles', async () => {
  await withRepositories(async (players, profiles) => {
    const interaction = createInteraction({
      subcommand: 'add',
      connectCode: 'MISS#123',
    });

    await handlePlayerCommand(
      interaction,
      players,
      profiles,
      createSlippiClient(async () => null),
    );

    assert.match(interaction.response.content, /could not find a profile/i);
    assert.equal(players.get('guild-1', 'MISS#123'), undefined);
    assert.equal(profiles.get('MISS#123'), undefined);
  });
});

test('player add preserves the roster during an API outage', async () => {
  await withRepositories(async (players, profiles) => {
    const interaction = createInteraction({
      subcommand: 'add',
      connectCode: 'ABCD#123',
    });

    await handlePlayerCommand(
      interaction,
      players,
      profiles,
      createSlippiClient(async () => {
        throw new SlippiApiError('Slippi API returned HTTP 503.', 503);
      }),
    );

    assert.match(interaction.response.content, /temporarily unavailable/i);
    assert.match(interaction.response.content, /No changes were made/i);
    assert.equal(players.get('guild-1', 'ABCD#123'), undefined);
    assert.equal(profiles.get('ABCD#123'), undefined);
  });
});

test('player add rejects malformed input', async () => {
  await withRepositories(async (players, profiles) => {
    let lookupCount = 0;
    const interaction = createInteraction({
      subcommand: 'add',
      connectCode: 'not-a-code',
    });

    await handlePlayerCommand(
      interaction,
      players,
      profiles,
      createSlippiClient(async () => {
        lookupCount += 1;
        return null;
      }),
    );

    assert.equal(lookupCount, 0);
    assert.match(interaction.response.content, /Invalid Connect Code/);
    assert.equal(interaction.response.flags, MessageFlags.Ephemeral);
  });
});

test('player add skips lookup for existing registrations', async () => {
  await withRepositories(async (players, profiles) => {
    players.add('guild-1', 'ABCD#123', 'original-user');
    let lookupCount = 0;
    const interaction = createInteraction({
      subcommand: 'add',
      connectCode: 'abcd#123',
      userId: 'second-user',
    });

    await handlePlayerCommand(
      interaction,
      players,
      profiles,
      createSlippiClient(async () => {
        lookupCount += 1;
        throw new Error('Should not be called');
      }),
    );

    assert.equal(
      interaction.response.content,
      "ABCD#123 is already registered on this server's leaderboard.",
    );
    assert.equal(lookupCount, 0);
    assert.equal(players.get('guild-1', 'ABCD#123')?.addedByDiscordUserId, 'original-user');
  });
});

test('player remove does not call Slippi', async () => {
  await withRepositories(async (players, profiles) => {
    players.add('guild-1', 'ABCD#123', 'user-1');
    let lookupCount = 0;
    const interaction = createInteraction({
      subcommand: 'remove',
      connectCode: 'abcd#123',
    });

    await handlePlayerCommand(
      interaction,
      players,
      profiles,
      createSlippiClient(async () => {
        lookupCount += 1;
        return null;
      }),
    );

    assert.equal(interaction.response.content, "Removed ABCD#123 from this server's leaderboard.");
    assert.equal(players.get('guild-1', 'ABCD#123'), undefined);
    assert.equal(lookupCount, 0);
  });
});

test('player command rejects direct-message use ephemerally', async () => {
  await withRepositories(async (players, profiles) => {
    const interaction = createInteraction({
      guildId: null,
      subcommand: 'add',
      connectCode: 'ABCD#123',
    });

    await handlePlayerCommand(interaction, players, profiles, createSlippiClient());

    assert.equal(interaction.deferred, false);
    assert.equal(
      interaction.response.content,
      'This command can only be used in a Discord server.',
    );
    assert.equal(interaction.response.flags, MessageFlags.Ephemeral);
    assert.equal(players.list('guild-1').length, 0);
  });
});

test('player add accepts a hyphen separator and stores the canonical Connect Code', async () => {
  await withRepositories(async (players, profiles) => {
    let lookupCode;
    const interaction = createInteraction({
      subcommand: 'add',
      connectCode: 'abcd-123',
    });

    await handlePlayerCommand(
      interaction,
      players,
      profiles,
      createSlippiClient(async (code) => {
        lookupCode = code;
        return {
          connectCode: code,
          displayName: 'Test Player',
          rating: 1500,
          ratingUpdateCount: 15,
          wins: 10,
          losses: 5,
          dailyGlobalPlacement: null,
          dailyRegionalPlacement: null,
          continent: 'North America',
        };
      }),
    );

    assert.equal(lookupCode, 'ABCD#123');
    assert.ok(players.get('guild-1', 'ABCD#123'));
  });
});
