import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { LeaderboardSnapshot, LeaderboardService } from '../services/leaderboard-service.js';
import { LEADERBOARD_PAGE_SIZE } from '../domain/leaderboard.js';
import {
  createLeaderboardButtonCustomId,
  isLegacyLeaderboardButtonCustomId,
  parseLeaderboardButtonCustomId,
} from '../domain/leaderboard-pagination.js';
import {
  formatCompactLeaderboardPage,
  formatRichLeaderboardPage,
} from '../presentation/leaderboard-format.js';
import type {
  LeaderboardFormat,
  LeaderboardSessionStore,
} from '../services/leaderboard-session-store.js';

const COMPONENT_ACCENT_COLOR = 0x5865f2;
const NO_PLAYERS_MESSAGE = 'No players are registered yet. Add someone with `/player add`.';
const EXPIRED_SESSION_MESSAGE =
  'This leaderboard has expired or the bot has restarted. Run `/leaderboard` or ' +
  '`/leaderboard-compact` again to create a new one.';

/** Handle the rich, badge-oriented /leaderboard command. */
export async function handleLeaderboardCommand(
  interaction: ChatInputCommandInteraction,
  leaderboard: LeaderboardService,
  sessions: LeaderboardSessionStore,
  applicationEmojiTags: ReadonlyMap<string, string>,
): Promise<void> {
  await handleLeaderboard(interaction, leaderboard, sessions, applicationEmojiTags, 'rich');
}

/** Handle the compact, monospaced /leaderboard-compact command. */
export async function handleCompactLeaderboardCommand(
  interaction: ChatInputCommandInteraction,
  leaderboard: LeaderboardService,
  sessions: LeaderboardSessionStore,
): Promise<void> {
  await handleLeaderboard(interaction, leaderboard, sessions, new Map(), 'compact');
}

/**
 * Handle leaderboard pagination globally. This deliberately does not use a
 * MessageComponentCollector: the interactionCreate listener stays active for
 * the lifetime of the bot and explicitly acknowledges stale buttons.
 */
export async function handleLeaderboardButtonInteraction(
  interaction: ButtonInteraction,
  sessions: LeaderboardSessionStore,
  applicationEmojiTags: ReadonlyMap<string, string>,
): Promise<void> {
  if (isLegacyLeaderboardButtonCustomId(interaction.customId)) {
    await expireLeaderboardMessage(interaction);
    return;
  }

  const parsedButton = parseLeaderboardButtonCustomId(interaction.customId);

  if (!parsedButton) {
    await expireLeaderboardMessage(interaction);
    return;
  }

  const { sessionId, action } = parsedButton;
  const session = sessions.get(sessionId);

  if (!session) {
    await expireLeaderboardMessage(interaction);
    return;
  }

  if (interaction.user.id !== session.ownerUserId) {
    await replyEphemeral(
      interaction,
      'Only the person who requested this leaderboard can change its pages.',
    );
    return;
  }

  const nextPage =
    action === 'previous'
      ? Math.max(0, session.pageIndex - 1)
      : Math.min(session.pageCount - 1, session.pageIndex + 1);

  if (nextPage === session.pageIndex) {
    await replyEphemeral(
      interaction,
      'You are already at the beginning or end of this leaderboard.',
    );
    return;
  }

  try {
    if (session.format === 'rich') {
      await interaction.update({
        components: createRichComponents(
          session.snapshot,
          nextPage,
          session.pageCount,
          session.id,
          applicationEmojiTags,
        ),
        allowedMentions: { parse: [] },
      });
    } else {
      await interaction.update({
        content: formatCompactLeaderboardPage(session.snapshot, {
          pageIndex: nextPage,
          pageCount: session.pageCount,
        }),
        embeds: [],
        components: createPaginationComponents(session.id, nextPage, session.pageCount),
        allowedMentions: { parse: [] },
      });
    }

    sessions.setPage(session.id, nextPage);
  } catch (error) {
    console.error('Could not update leaderboard pagination:', error);
    sessions.delete(session.id);

    // If the source message is inaccessible, try to acknowledge the click
    // with a private explanation instead of leaving Discord to show a timeout.
    await expireLeaderboardMessage(
      interaction,
      'I could not update that leaderboard message. Run `/leaderboard` again for a fresh one.',
    );
  }
}

async function expireLeaderboardMessage(
  interaction: ButtonInteraction,
  explanation = EXPIRED_SESSION_MESSAGE,
): Promise<void> {
  // Acknowledge the button click immediately. Do not attempt to edit the
  // original message: it may be an old Components V2 message that the bot
  // can no longer edit.
  await replyEphemeral(interaction, explanation);
}

async function handleLeaderboard(
  interaction: ChatInputCommandInteraction,
  leaderboard: LeaderboardService,
  sessions: LeaderboardSessionStore,
  applicationEmojiTags: ReadonlyMap<string, string>,
  format: LeaderboardFormat,
): Promise<void> {
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({
      content: 'This command can only be used in a Discord server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  const snapshot = await leaderboard.getLeaderboard(guildId, async (progress) => {
    if (progress.completed === 1 || progress.completed % 10 === 0) {
      await interaction.editReply({
        content: `Refreshing Slippi profiles (${progress.completed}/${progress.total})…`,
        embeds: [],
        components: [],
      });
    }
  });

  if (snapshot.registeredPlayerCount === 0) {
    await interaction.editReply({
      content: NO_PLAYERS_MESSAGE,
      embeds: [],
      components: [],
      allowedMentions: { parse: [] },
    });
    return;
  }

  const pageCount = Math.ceil(snapshot.entries.length / LEADERBOARD_PAGE_SIZE);
  const session = sessions.create(interaction.user.id, format, snapshot);
  const sessionId = session?.id ?? 'single-page';

  if (format === 'rich') {
    await interaction.editReply({
      content: null,
      embeds: [],
      components: createRichComponents(snapshot, 0, pageCount, sessionId, applicationEmojiTags),
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
  } else {
    await interaction.editReply({
      content: formatCompactLeaderboardPage(snapshot, { pageIndex: 0, pageCount }),
      embeds: [],
      components: session ? createPaginationComponents(session.id, 0, pageCount) : [],
      allowedMentions: { parse: [] },
    });
  }
}

function createRichComponents(
  snapshot: LeaderboardSnapshot,
  pageIndex: number,
  pageCount: number,
  sessionId: string,
  applicationEmojiTags: ReadonlyMap<string, string>,
): (ContainerBuilder | ActionRowBuilder<ButtonBuilder>)[] {
  const container = new ContainerBuilder()
    .setAccentColor(COMPONENT_ACCENT_COLOR)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        formatRichLeaderboardPage(snapshot, {
          pageIndex,
          pageCount,
          applicationEmojiTags,
        }),
      ),
    );

  return [container, ...createPaginationComponents(sessionId, pageIndex, pageCount)];
}

function createPaginationComponents(
  sessionId: string,
  currentPage: number,
  pageCount: number,
): ActionRowBuilder<ButtonBuilder>[] {
  if (pageCount <= 1) {
    return [];
  }

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(createLeaderboardButtonCustomId(sessionId, 'previous'))
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId(createLeaderboardButtonCustomId(sessionId, 'next'))
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === pageCount - 1),
    ),
  ];
}

async function replyEphemeral(interaction: ButtonInteraction, content: string): Promise<void> {
  try {
    if (interaction.deferred || interaction.replied) {
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
  } catch (error) {
    console.error('Could not acknowledge leaderboard button interaction:', error);
  }
}
