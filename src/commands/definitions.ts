import { SlashCommandBuilder } from 'discord.js';

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the community Slippi leaderboard.'),
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
];
