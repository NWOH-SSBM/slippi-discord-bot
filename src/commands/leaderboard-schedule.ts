import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { LeaderboardScheduleRepository } from '../database/leaderboard-schedule-repository.js';
import type { Weekday } from '../domain/leaderboard-schedule.js';
import { WEEKDAY_NAMES } from '../domain/leaderboard-schedule.js';
import type { LeaderboardScheduler } from '../services/leaderboard-scheduler.js';

const COMMON_TIME_ZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Kolkata',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const;

const SUPPORTED_TIME_ZONES = buildSupportedTimeZones();

export async function handleLeaderboardScheduleCommand(
  interaction: ChatInputCommandInteraction,
  schedules: LeaderboardScheduleRepository,
  scheduler: LeaderboardScheduler,
): Promise<void> {
  const guildId = interaction.guildId;

  if (!guildId) {
    await replyEphemeral(interaction, 'This command can only be used in a Discord server.');
    return;
  }

  switch (interaction.options.getSubcommand()) {
    case 'set':
      await setSchedule(interaction, guildId, schedules, scheduler);
      return;

    case 'show': {
      const schedule = schedules.get(guildId);

      if (!schedule) {
        await replyEphemeral(
          interaction,
          'No recurring leaderboard schedule is configured for this server.',
        );
        return;
      }

      const nextRun = scheduler.getNextRun(schedule);
      const nextRunDescription = nextRun
        ? formatDateInTimeZone(nextRun, schedule.timeZone)
        : 'Could not calculate the next occurrence';
      const lastRunDescription = formatLastRun(schedule.lastRunAt, schedule.lastRunStatus);
      const lastError = schedule.lastError
        ? `\nMost recent error: \`${escapeInlineCode(schedule.lastError)}\``
        : '';

      await replyEphemeral(
        interaction,
        [
          '**Recurring leaderboard schedule**',
          `Status: **${schedule.enabled ? 'Enabled' : 'Paused'}**`,
          `Day: **${WEEKDAY_NAMES[schedule.dayOfWeek]}**`,
          `Time: **${schedule.localTime}** (${schedule.timeZone})`,
          `Channel: <#${schedule.channelId}>`,
          `Format: **${schedule.format}**`,
          `Next occurrence: **${schedule.enabled ? nextRunDescription : `Paused (next occurrence if resumed: ${nextRunDescription})`}**`,
          `Last run: ${lastRunDescription}${lastError}`,
        ].join('\n'),
      );
      return;
    }

    case 'pause':
      await setScheduleEnabled(interaction, guildId, schedules, scheduler, false);
      return;

    case 'resume':
      await setScheduleEnabled(interaction, guildId, schedules, scheduler, true);
      return;

    case 'remove': {
      const removed = schedules.remove(guildId);
      scheduler.remove(guildId);
      await replyEphemeral(
        interaction,
        removed
          ? 'The recurring leaderboard schedule has been removed.'
          : 'There is no recurring leaderboard schedule to remove.',
      );
      return;
    }

    case 'test':
      await testSchedule(interaction, guildId, schedules, scheduler);
      return;

    default:
      await replyEphemeral(interaction, 'Unknown leaderboard schedule action.');
  }
}

export async function handleLeaderboardScheduleAutocomplete(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);

  if (focused.name !== 'time-zone') {
    await interaction.respond([]);
    return;
  }

  const query = String(focused.value).trim().toLocaleLowerCase('en-US');
  const choices = SUPPORTED_TIME_ZONES.filter((timeZone) =>
    timeZone.toLocaleLowerCase('en-US').includes(query),
  )
    .slice(0, 25)
    .map((timeZone) => ({ name: timeZone, value: timeZone }));

  await interaction.respond(choices);
}

async function setSchedule(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  schedules: LeaderboardScheduleRepository,
  scheduler: LeaderboardScheduler,
): Promise<void> {
  const channel = interaction.options.getChannel('channel', true, [
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
  ]);

  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
    await replyEphemeral(
      interaction,
      'The destination must be a text or announcement channel in this server.',
    );
    return;
  }

  if (channel.guildId !== guildId) {
    await replyEphemeral(interaction, 'The destination channel must belong to this server.');
    return;
  }

  const guild = interaction.guild;

  if (!guild) {
    await replyEphemeral(interaction, 'This command can only be used in a Discord server.');
    return;
  }

  const botMember = guild.members.me ?? (await guild.members.fetchMe());
  const permissions = channel.permissionsFor(botMember);

  if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
    await replyEphemeral(
      interaction,
      'I need **View Channel** and **Send Messages** permissions in the selected destination channel.',
    );
    return;
  }

  try {
    const schedule = schedules.save({
      guildId,
      channelId: channel.id,
      dayOfWeek: interaction.options.getInteger('day', true) as Weekday,
      localTime: interaction.options.getString('time', true),
      timeZone: interaction.options.getString('time-zone', true),
      format: interaction.options.getString('format', true) as 'rich' | 'compact',
      actorDiscordUserId: interaction.user.id,
    });

    scheduler.sync(guildId);
    const nextRun = scheduler.getNextRun(schedule);

    await replyEphemeral(
      interaction,
      [
        'Successfully saved and enabled the weekly leaderboard schedule.',
        `Day: **${WEEKDAY_NAMES[schedule.dayOfWeek]}**`,
        `Time: **${schedule.localTime}** (${schedule.timeZone})`,
        `Channel: <#${schedule.channelId}>`,
        `Format: **${schedule.format}**`,
        `Next post: **${nextRun ? formatDateInTimeZone(nextRun, schedule.timeZone) : 'Unknown'}**`,
      ].join('\n'),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The schedule could not be saved.';
    console.error(`Could not configure leaderboard schedule for guild ${guildId}:`, error);
    await replyEphemeral(interaction, `Could not configure the schedule: ${message}`);
  }
}

async function setScheduleEnabled(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  schedules: LeaderboardScheduleRepository,
  scheduler: LeaderboardScheduler,
  enabled: boolean,
): Promise<void> {
  const current = schedules.get(guildId);

  if (!current) {
    await replyEphemeral(
      interaction,
      'No recurring leaderboard schedule is configured for this server.',
    );
    return;
  }

  if (current.enabled === enabled) {
    await replyEphemeral(
      interaction,
      enabled
        ? 'The leaderboard schedule is already enabled.'
        : 'The leaderboard schedule is already paused.',
    );
    return;
  }

  const updated = schedules.setEnabled(guildId, enabled, interaction.user.id);

  if (!updated) {
    await replyEphemeral(interaction, 'The leaderboard schedule could not be updated.');
    return;
  }

  scheduler.sync(guildId);
  const nextRun = scheduler.getNextRun(updated);
  const nextRunDescription = nextRun ? formatDateInTimeZone(nextRun, updated.timeZone) : 'Unknown';

  await replyEphemeral(
    interaction,
    enabled
      ? `The leaderboard schedule has been resumed. Next post: **${nextRunDescription}**.`
      : 'The leaderboard schedule has been paused. Use `/leaderboard-schedule resume` to reactivate it.',
  );
}

async function testSchedule(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  schedules: LeaderboardScheduleRepository,
  scheduler: LeaderboardScheduler,
): Promise<void> {
  const schedule = schedules.get(guildId);

  if (!schedule) {
    await replyEphemeral(
      interaction,
      'Configure a schedule with `/leaderboard-schedule set` before testing it.',
    );
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    await scheduler.publishTest(guildId);
    await interaction.editReply({
      content: `Test leaderboard published in <#${schedule.channelId}>. Scheduled-run history was not changed.`,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown publication error.';
    await interaction.editReply({
      content: `The test leaderboard could not be published: ${message}`,
      allowedMentions: { parse: [] },
    });
  }
}

async function replyEphemeral(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<void> {
  await interaction.reply({
    content,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

function formatDateInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone,
  }).format(date);
}

function formatLastRun(timestamp: string | null, status: 'success' | 'failure' | null): string {
  if (!timestamp || !status) {
    return 'No scheduled post has run yet.';
  }

  const formatted = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(timestamp));

  return `**${status === 'success' ? 'Success' : 'Failure'}** on ${formatted} UTC.`;
}

function escapeInlineCode(value: string): string {
  return value.replace(/[\r\n`]/g, ' ').slice(0, 500);
}

function buildSupportedTimeZones(): string[] {
  const common = new Set<string>(COMMON_TIME_ZONES);
  const remaining = Intl.supportedValuesOf('timeZone')
    .filter((timeZone) => !common.has(timeZone))
    .sort((left, right) => left.localeCompare(right, 'en'));

  // Keep common zones first so the initial 25 autocomplete suggestions are useful.
  return [...COMMON_TIME_ZONES, ...remaining];
}
