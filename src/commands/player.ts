import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import type { PlayerRepository } from '../database/player-repository.js';
import { normalizeConnectCode } from '../domain/connect-code.js';

/**
 * Handle the /player command family.
 *
 * The response is public so roster changes are visible to the community.
 * The repository also records the Discord user ID responsible for each add.
 */
export async function handlePlayerCommand(
  interaction: ChatInputCommandInteraction,
  players: PlayerRepository,
): Promise<void> {
  const guildId = interaction.guildId;

  // The command is intended for server leaderboards, not direct messages.
  if (!guildId) {
    await interaction.reply({
      content: 'This command can only be used in a Discord server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  const connectCode = interaction.options.getString('connect-code', true);

  // Acknowledge before performing database operations, leaving room for future
  // validation against Slippi without risking Discord's interaction deadline.
  await interaction.deferReply();

  let response: string;

  try {
    switch (subcommand) {
      case 'add': {
        const result = players.add(guildId, connectCode, interaction.user.id);

        response =
          result.status === 'added'
            ? `Added ${result.player.connectCode} to this server's leaderboard.`
            : `${result.player.connectCode} is already registered on this server's leaderboard.`;
        break;
      }

      case 'remove': {
        const normalizedConnectCode = normalizeConnectCode(connectCode);
        const removed = players.remove(guildId, normalizedConnectCode);

        const playerLabel = normalizedConnectCode || 'That Connect Code';
        response = removed
          ? `Removed ${playerLabel} from this server's leaderboard.`
          : `${playerLabel} is not registered on this server's leaderboard.`;
        break;
      }

      default:
        response = 'Unknown player command.';
    }
  } catch (error) {
    if (error instanceof RangeError) {
      response = `Invalid Connect Code: ${error.message}`;
    } else {
      throw error;
    }
  }

  // Connect Codes are user input. Disable mention parsing so an unexpected
  // value can never trigger @everyone, @here, or a user/role mention.
  await interaction.editReply({
    content: response,
    allowedMentions: { parse: [] },
  });
}
