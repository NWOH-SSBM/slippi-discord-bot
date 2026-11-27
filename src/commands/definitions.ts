import { ChannelType, SlashCommandBuilder } from 'discord.js';

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the rich community Slippi leaderboard with rank badges.'),
  new SlashCommandBuilder()
    .setName('leaderboard-compact')
    .setDescription('Show a compact, text-only community Slippi leaderboard.'),
  new SlashCommandBuilder()
    .setName('player')
    .setDescription('Add or remove a player from the community leaderboard.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Add a player to the community leaderboard.')
        .addStringOption((option) =>
          option
            .setName('connect-code')
            .setDescription('The player’s Slippi Connect Code.')
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('Remove a player from the community leaderboard.')
        .addStringOption((option) =>
          option
            .setName('connect-code')
            .setDescription('The player’s Slippi Connect Code.')
            .setRequired(true),
        ),
    ),
  new SlashCommandBuilder()
    .setName('leaderboard-schedule')
    .setDescription('Configure recurring automatic leaderboard posts.')
    .setDefaultMemberPermissions(0n)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set')
        .setDescription('Create or replace this server’s weekly leaderboard schedule.')
        .addIntegerOption((option) =>
          option
            .setName('day')
            .setDescription('Day of the week for the recurring post.')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(6)
            .addChoices(
              { name: 'Sunday', value: 0 },
              { name: 'Monday', value: 1 },
              { name: 'Tuesday', value: 2 },
              { name: 'Wednesday', value: 3 },
              { name: 'Thursday', value: 4 },
              { name: 'Friday', value: 5 },
              { name: 'Saturday', value: 6 },
            ),
        )
        .addStringOption((option) =>
          option
            .setName('time')
            .setDescription('Local time in 24-hour HH:MM format, for example 18:30.')
            .setRequired(true)
            .setMinLength(5)
            .setMaxLength(5),
        )
        .addStringOption((option) =>
          option
            .setName('time-zone')
            .setDescription('IANA time zone, for example America/New_York.')
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Text or announcement channel for the scheduled post.')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addStringOption((option) =>
          option
            .setName('format')
            .setDescription('Leaderboard presentation format.')
            .setRequired(true)
            .addChoices(
              { name: 'Rich (rank badges and profile links)', value: 'rich' },
              { name: 'Compact (text-only table)', value: 'compact' },
            ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('show').setDescription('Show the current schedule and its next run.'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('pause').setDescription('Pause automatic leaderboard posts.'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('resume').setDescription('Resume automatic leaderboard posts.'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('remove').setDescription('Remove this server’s recurring schedule.'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('test').setDescription('Publish a test leaderboard immediately.'),
    ),
];
