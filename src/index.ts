import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import {
  handleLeaderboardScheduleAutocomplete,
  handleLeaderboardScheduleCommand,
} from './commands/leaderboard-schedule.js';
import {
  handleCompactLeaderboardCommand,
  handleLeaderboardButtonInteraction,
  handleLeaderboardCommand,
} from './commands/leaderboard.js';
import { handlePlayerCommand } from './commands/player.js';
import { config } from './config.js';
import { isLeaderboardButtonCustomId } from './domain/leaderboard-pagination.js';
import { openDatabase } from './database/database.js';
import { LeaderboardScheduleRepository } from './database/leaderboard-schedule-repository.js';
import { PlayerRepository } from './database/player-repository.js';
import { ProfileCacheRepository } from './database/profile-cache-repository.js';
import { LeaderboardSessionStore } from './services/leaderboard-session-store.js';
import { LeaderboardSchedulePublisher } from './services/leaderboard-schedule-publisher.js';
import { LeaderboardScheduler } from './services/leaderboard-scheduler.js';
import { LeaderboardService } from './services/leaderboard-service.js';
import { SlippiClient } from './services/slippi-client.js';

const database = openDatabase(config.databasePath);
const players = new PlayerRepository(database);
const profiles = new ProfileCacheRepository(database);
const schedules = new LeaderboardScheduleRepository(database);
const slippi = new SlippiClient({ endpoint: config.slippiGraphqlEndpoint });
const leaderboard = new LeaderboardService(players, profiles, slippi);
const leaderboardSessions = new LeaderboardSessionStore();

const client = new Client({
  // Slash commands, autocomplete, and components only require the Guilds intent.
  intents: [GatewayIntentBits.Guilds],
});

// Keep this Map instance stable because the scheduled publisher receives it by reference.
const applicationEmojiTags = new Map<string, string>();
const schedulePublisher = new LeaderboardSchedulePublisher(
  client,
  leaderboard,
  applicationEmojiTags,
);
const scheduler = new LeaderboardScheduler(schedules, (schedule) =>
  schedulePublisher.publish(schedule),
);

client.once(Events.ClientReady, async (readyClient) => {
  console.info(`Logged in as ${readyClient.user.tag}.`);
  console.info(`SQLite database opened at ${config.databasePath}.`);

  try {
    const emojis = await readyClient.application.emojis.fetch();
    applicationEmojiTags.clear();

    for (const emoji of emojis.values()) {
      if (emoji.name) {
        applicationEmojiTags.set(emoji.name, `<:${emoji.name}:${emoji.id}>`);
      }
    }

    console.info(`Loaded ${applicationEmojiTags.size} application emoji(s).`);
  } catch (error) {
    // Scheduled and manually requested rich leaderboards remain usable with
    // textual rank labels if application emoji access is temporarily unavailable.
    console.warn('Could not load Discord application rank emojis:', error);
  }

  scheduler.start();
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

  if (interaction.isAutocomplete()) {
    if (interaction.commandName === 'leaderboard-schedule') {
      try {
        await handleLeaderboardScheduleAutocomplete(interaction);
      } catch (error) {
        console.error('Failed to provide leaderboard schedule autocomplete:', error);
        if (!interaction.responded) {
          await interaction.respond([]).catch((respondError: unknown) => {
            console.error('Could not acknowledge schedule autocomplete:', respondError);
          });
        }
      }
    }
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

      case 'leaderboard-schedule':
        await handleLeaderboardScheduleCommand(interaction, schedules, scheduler);
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

let shutdownPromise: Promise<void> | undefined;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    console.info(`Received ${signal}; stopping scheduled jobs and shutting down.`);
    try {
      await scheduler.shutdown();
    } catch (error) {
      console.error('Error while stopping the leaderboard scheduler:', error);
    } finally {
      client.destroy();
      database.close();
    }
  })();

  return shutdownPromise;
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await client.login(config.discordToken);
} catch (error) {
  await scheduler.shutdown();
  client.destroy();
  database.close();
  throw error;
}
