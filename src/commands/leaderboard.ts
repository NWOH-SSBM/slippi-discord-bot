import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type {
  LeaderboardEntry,
  LeaderboardSnapshot,
  LeaderboardService,
} from '../services/leaderboard-service.js';

const PAGE_SIZE = 20;
const COLLECTOR_TIMEOUT_MS = 2 * 60 * 1_000;

/** Handle /leaderboard and provide button-based pagination when needed. */
export async function handleLeaderboardCommand(
  interaction: ChatInputCommandInteraction,
  leaderboard: LeaderboardService,
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
      content: 'No players are registered yet. Add someone with `/player add`.',
      embeds: [],
      components: [],
      allowedMentions: { parse: [] },
    });
    return;
  }

  const pages = createPages(snapshot);
  let currentPage = 0;

  const message = await interaction.editReply({
    content: null,
    embeds: [pages[currentPage]!],
    components: createPaginationComponents(currentPage, pages.length),
    allowedMentions: { parse: [] },
  });

  if (pages.length <= 1) {
    return;
  }

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: COLLECTOR_TIMEOUT_MS,
  });

  collector.on('collect', async (buttonInteraction) => {
    if (buttonInteraction.user.id !== interaction.user.id) {
      await buttonInteraction.reply({
        content: 'Only the person who requested this leaderboard can change pages.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (buttonInteraction.customId === 'leaderboard:previous') {
      currentPage = Math.max(0, currentPage - 1);
    } else if (buttonInteraction.customId === 'leaderboard:next') {
      currentPage = Math.min(pages.length - 1, currentPage + 1);
    }

    await buttonInteraction.update({
      embeds: [pages[currentPage]!],
      components: createPaginationComponents(currentPage, pages.length),
      allowedMentions: { parse: [] },
    });
  });

  collector.on('end', async () => {
    try {
      await message.edit({ components: [] });
    } catch (error) {
      console.warn('Could not remove expired leaderboard pagination buttons:', error);
    }
  });
}

export function createPages(snapshot: LeaderboardSnapshot): EmbedBuilder[] {
  const pageCount = Math.ceil(snapshot.entries.length / PAGE_SIZE);

  return Array.from({ length: pageCount }, (_, pageIndex) => {
    const pageEntries = snapshot.entries.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE);

    const description = [
      ...buildStatusLines(snapshot),
      '**# · Player · Rank · Rating · Record**',
      ...pageEntries.map((entry, index) =>
        formatLeaderboardEntry(entry, pageIndex * PAGE_SIZE + index + 1),
      ),
    ].join('\n');

    return new EmbedBuilder()
      .setTitle('Slippi Leaderboard')
      .setDescription(description)
      .setFooter({
        text: `Page ${pageIndex + 1} of ${pageCount} · ${formatOldestProfileDate(snapshot)}`,
      });
  });
}

function buildStatusLines(snapshot: LeaderboardSnapshot): string[] {
  const lines: string[] = [];

  if (snapshot.apiUnavailable) {
    lines.push(
      '⚠️ Slippi is temporarily unavailable. Showing the last successfully cached profile data where available.',
    );
  }

  if (snapshot.missingProfileCount > 0) {
    lines.push(`ℹ️ ${snapshot.missingProfileCount} player profile(s) do not have cached data yet.`);
  }

  if (snapshot.notFoundProfileCount > 0) {
    lines.push(
      `ℹ️ Slippi did not return ${snapshot.notFoundProfileCount} profile(s); roster registrations were retained.`,
    );
  }

  if (snapshot.staleProfileCount > 0 && !snapshot.apiUnavailable) {
    lines.push(
      `ℹ️ ${snapshot.staleProfileCount} cached profile(s) are older than the refresh interval.`,
    );
  }

  if (snapshot.refreshedProfileCount > 0) {
    lines.push(`Updated ${snapshot.refreshedProfileCount} player profile(s) from Slippi.`);
  }

  return lines.length > 0 ? [...lines, ''] : [];
}

function formatLeaderboardEntry(entry: LeaderboardEntry, position: number): string {
  const name = escapeMarkdown(
    (entry.profile?.displayName ?? entry.registration.connectCode).slice(0, 48),
  );
  const rating = entry.profile?.rating;
  const ratingText = rating === null || rating === undefined ? '—' : formatRating(rating);
  const wins = entry.profile?.wins;
  const losses = entry.profile?.losses;
  const record =
    wins === null || wins === undefined || losses === null || losses === undefined
      ? '—'
      : `${wins}W/${losses}L`;

  return `\`${String(position).padStart(2, '0')}\` **${name}** · **${entry.rank}** · ${ratingText} · ${record}`;
}

function createPaginationComponents(
  currentPage: number,
  pageCount: number,
): ActionRowBuilder<ButtonBuilder>[] {
  if (pageCount <= 1) {
    return [];
  }

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('leaderboard:previous')
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId('leaderboard:next')
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === pageCount - 1),
    ),
  ];
}

function formatOldestProfileDate(snapshot: LeaderboardSnapshot): string {
  const timestamps = snapshot.entries
    .map((entry) => (entry.profile ? Date.parse(entry.profile.fetchedAt) : Number.NaN))
    .filter(Number.isFinite);

  if (timestamps.length === 0) {
    return 'No profile data cached';
  }

  const oldestTimestamp = Math.min(...timestamps);
  const formatted = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(oldestTimestamp);

  return `Oldest profile refresh: ${formatted} UTC`;
}

function formatRating(rating: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(rating);
}

function escapeMarkdown(value: string): string {
  // Display names are supplied by Slippi profiles. Escape Markdown controls
  // so a name cannot inject links, formatting, or block structure into embeds.
  return value.replace(/[\r\n]/g, ' ').replace(/([\\`*_~|>\[\]()])/g, '\\$1');
}
