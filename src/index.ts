import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import {
  handleCompactLeaderboardCommand,
  handleLeaderboardButtonInteraction,
  handleLeaderboardCommand,
} from './commands/leaderboard.js';
import { handlePlayerCommand } from './commands/player.js';
import { config } from './config.js';
import { isLeaderboardButtonCustomId } from './domain/leaderboard-pagination.js';
import { openDatabase } from './database/database.js';
import { PlayerRepository } from './database/player-repository.js';
import { ProfileCacheRepository } from './database/profile-cache-repository.js';
import { LeaderboardSessionStore } from './services/leaderboard-session-store.js';
import { LeaderboardService } from './services/leaderboard-service.js';
import { SlippiClient } from './services/slippi-client.js';

const database = openDatabase(config.databasePath);
const players = new PlayerRepository(database);
const profiles = new ProfileCacheRepository(database);
const slippi = new SlippiClient({ endpoint: config.slippiGraphqlEndpoint });
const leaderboard = new LeaderboardService(players, profiles, slippi);
const leaderboardSessions = new LeaderboardSessionStore();

const client = new Client({
  // Slash commands and components only require the Guilds intent.
  intents: [GatewayIntentBits.Guilds],
});

let applicationEmojiTags = new Map<string, string>();

client.once(Events.ClientReady, async (readyClient) => {
  console.info(`Logged in as ${readyClient.user.tag}.`);
  console.info(`SQLite database opened at ${config.databasePath}.`);

  try {
    const emojis = await readyClient.application.emojis.fetch();
    applicationEmojiTags = new Map(
      emojis.map((emoji) => [emoji.name, `<:${emoji.name}:${emoji.id}>`] as const),
    );
    console.info(`Loaded ${applicationEmojiTags.size} application emoji(s).`);
  } catch (error) {
    // The leaderboard remains usable with textual rank labels if emoji access
    // is temporarily unavailable or the assets have not been synchronized.
    console.warn('Could not load Discord application rank emojis:', error);
  }
});

client.on(Events.Error, (error) => {
  console.error('Discord client error:', error);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton() && isLeaderboardButtonCustomId(interaction.customId)) {
    await handleLeaderboardButtonInteraction(
      interaction,
      leaderboardSessions,
      applicationEmojiTags,
    );
    return;
  }

  if (!interaction.isChatInputCommand()) {
    return;
  }

  try {
    switch (interaction.commandName) {
      case 'player':
        await handlePlayerCommand(interaction, players, profiles, slippi);
        break;

      case 'leaderboard':
        await handleLeaderboardCommand(
          interaction,
          leaderboard,
          leaderboardSessions,
          applicationEmojiTags,
        );
        break;

      case 'leaderboard-compact':
        await handleCompactLeaderboardCommand(interaction, leaderboard, leaderboardSessions);
        break;

      default:
        console.warn(`Received unhandled command: /${interaction.commandName}`);
    }
  } catch (error) {
    console.error(`Failed to handle /${interaction.commandName}:`, error);

    const content = 'Something went wrong while processing that command. Please try again later.';

    try {
      if (interaction.deferred) {
        await interaction.editReply({
          content,
          allowedMentions: { parse: [] },
        });
      } else if (interaction.replied) {
        await interaction.followUp({
          content,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
      } else {
        await interaction.reply({
          content,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
      }
    } catch (replyError) {
      console.error('Failed to send command error response:', replyError);
    }
  }
});

let shutdownStarted = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shutdownStarted) {
    return;
  }

  shutdownStarted = true;
  console.info(`Received ${signal}; shutting down Discord client and database.`);
  client.destroy();
  database.close();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

try {
  await client.login(config.discordToken);
} catch (error) {
  client.destroy();
  database.close();
  throw error;
}
