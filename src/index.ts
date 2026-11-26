import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { handlePlayerCommand } from './commands/player.js';
import { config } from './config.js';
import { openDatabase } from './database/database.js';
import { PlayerRepository } from './database/player-repository.js';
import { SlippiClient } from './services/slippi-client.js';

const database = openDatabase(config.databasePath);
const players = new PlayerRepository(database);
const slippi = new SlippiClient({ endpoint: config.slippiGraphqlEndpoint });

const client = new Client({
  // Slash commands only require the Guilds intent. Add other intents only when
  // an implemented feature demonstrably needs them.
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (readyClient) => {
  console.info(`Logged in as ${readyClient.user.tag}.`);
  console.info(`SQLite database opened at ${config.databasePath}.`);
});

client.on(Events.Error, (error) => {
  console.error('Discord client error:', error);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  try {
    switch (interaction.commandName) {
      case 'player':
        await handlePlayerCommand(interaction, players, slippi);
        break;

      case 'leaderboard':
        await interaction.reply({
          content:
            'Leaderboard retrieval is not implemented yet. Player registration is now persistent.',
          flags: MessageFlags.Ephemeral,
        });
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
