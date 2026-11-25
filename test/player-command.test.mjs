import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags } from 'discord.js';
import { openDatabase } from '../dist/database/database.js';
import { PlayerRepository } from '../dist/database/player-repository.js';
import { handlePlayerCommand } from '../dist/commands/player.js';

async function withRepository(callback) {
  const database = openDatabase(':memory:');

  try {
    await callback(new PlayerRepository(database));
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

test('player add command stores a normalized Connect Code and actor ID', async () => {
  await withRepository(async (players) => {
    const interaction = createInteraction({
      subcommand: 'add',
      connectCode: ' abcd#123 ',
    });

    await handlePlayerCommand(interaction, players);

    assert.equal(interaction.response.content, "Added ABCD#123 to this server's leaderboard.");
    assert.equal(interaction.deferred, true);
    assert.equal(players.get('guild-1', 'ABCD#123')?.addedByDiscordUserId, 'user-1');
  });
});

test('player add command reports an existing registration without replacing its actor', async () => {
  await withRepository(async (players) => {
    players.add('guild-1', 'ABCD#123', 'original-user');

    const interaction = createInteraction({
      subcommand: 'add',
      connectCode: 'abcd#123',
      userId: 'second-user',
    });

    await handlePlayerCommand(interaction, players);

    assert.equal(
      interaction.response.content,
      "ABCD#123 is already registered on this server's leaderboard.",
    );
    assert.equal(players.get('guild-1', 'ABCD#123')?.addedByDiscordUserId, 'original-user');
  });
});

test('player remove command removes a registered player', async () => {
  await withRepository(async (players) => {
    players.add('guild-1', 'ABCD#123', 'user-1');

    const interaction = createInteraction({
      subcommand: 'remove',
      connectCode: 'abcd#123',
    });

    await handlePlayerCommand(interaction, players);

    assert.equal(interaction.response.content, "Removed ABCD#123 from this server's leaderboard.");
    assert.equal(players.get('guild-1', 'ABCD#123'), undefined);
  });
});

test('player remove command reports when the player is not registered', async () => {
  await withRepository(async (players) => {
    const interaction = createInteraction({
      subcommand: 'remove',
      connectCode: 'abcd#123',
    });

    await handlePlayerCommand(interaction, players);

    assert.equal(
      interaction.response.content,
      "ABCD#123 is not registered on this server's leaderboard.",
    );
  });
});

test('player command explains invalid blank Connect Codes', async () => {
  await withRepository(async (players) => {
    const interaction = createInteraction({
      subcommand: 'add',
      connectCode: '   ',
    });

    await handlePlayerCommand(interaction, players);

    assert.match(interaction.response.content, /Invalid Connect Code/);
    assert.equal(players.list('guild-1').length, 0);
  });
});

test('player command rejects direct-message use ephemerally', async () => {
  await withRepository(async (players) => {
    const interaction = createInteraction({
      guildId: null,
      subcommand: 'add',
      connectCode: 'ABCD#123',
    });

    await handlePlayerCommand(interaction, players);

    assert.equal(interaction.deferred, false);
    assert.equal(
      interaction.response.content,
      'This command can only be used in a Discord server.',
    );
    assert.equal(interaction.response.flags, MessageFlags.Ephemeral);
    assert.equal(players.list('guild-1').length, 0);
  });
});
