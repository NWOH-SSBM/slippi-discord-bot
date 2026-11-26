import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import type { PlayerRepository } from '../database/player-repository.js';
import { isValidConnectCode, normalizeConnectCode } from '../domain/connect-code.js';
import { SlippiApiError, type SlippiClient } from '../services/slippi-client.js';

/**
 * Handle the /player command family.
 *
 * The response is public so roster changes are visible to the community.
 * The repository records the Discord user ID responsible for each add.
 */
export async function handlePlayerCommand(
  interaction: ChatInputCommandInteraction,
  players: PlayerRepository,
  slippi: SlippiClient,
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
  const connectCode = normalizeConnectCode(interaction.options.getString('connect-code', true));

  // Validate syntax before looking up or persisting a user-supplied value.
  if (!isValidConnectCode(connectCode)) {
    await interaction.reply({
      content: 'Invalid Connect Code. Use the format `ABCD#123` (1–7 letters, #, 1–7 digits).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Acknowledge before any network operation to stay within Discord's
  // interaction response deadline.
  await interaction.deferReply();

  let response: string;

  switch (subcommand) {
    case 'add': {
      // Avoid an API request when the player is already registered. The
      // repository still handles the race where two adds happen concurrently.
      const existingPlayer = players.get(guildId, connectCode);

      if (existingPlayer) {
        response = `${existingPlayer.connectCode} is already registered on this server's leaderboard.`;
        break;
      }

      let slippiPlayer: Awaited<ReturnType<SlippiClient['getPlayer']>>;

      try {
        slippiPlayer = await slippi.getPlayer(connectCode);
      } catch (error) {
        if (!(error instanceof SlippiApiError)) {
          throw error;
        }

        console.error('Slippi player verification failed:', error);
        response =
          'Slippi is temporarily unavailable, so the player could not be verified. No changes were made. Please try again later.';
        break;
      }

      if (!slippiPlayer) {
        response = `Slippi could not find a profile for ${connectCode}. Check the Connect Code and try again. Nothing was added.`;
        break;
      }

      const result = players.add(guildId, connectCode, interaction.user.id);

      response =
        result.status === 'added'
          ? `Added ${result.player.connectCode} (${slippiPlayer.displayName}) to this server's leaderboard.`
          : `${result.player.connectCode} is already registered on this server's leaderboard.`;
      break;
    }

    case 'remove': {
      const removed = players.remove(guildId, connectCode);

      response = removed
        ? `Removed ${connectCode} from this server's leaderboard.`
        : `${connectCode} is not registered on this server's leaderboard.`;
      break;
    }

    default:
      response = 'Unknown player command.';
  }

  // Connect Codes are user input. Disable mention parsing so an unexpected
  // value can never trigger @everyone, @here, or a user/role mention.
  await interaction.editReply({
    content: response,
    allowedMentions: { parse: [] },
  });
}
