import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { config } from './config.js';

const client = new Client({
  // Slash commands only require the Guilds intent. Add other intents only when
  // an implemented feature demonstrably needs them.
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (readyClient) => {
  console.info(`Logged in as ${readyClient.user.tag}.`);
});

client.on(Events.Error, (error) => {
  console.error('Discord client error:', error);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  // Temporary response keeps the scaffold safe to test before the command
  // handlers and persistence layer are implemented.
  try {
    await interaction.reply({
      content: 'The bot is online, but this command is not implemented yet.',
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    console.error(`Failed to acknowledge /${interaction.commandName}:`, error);
  }
});

function shutdown(signal: NodeJS.Signals): void {
  console.info(`Received ${signal}; shutting down Discord client.`);
  client.destroy();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

await client.login(config.discordToken);
