import type { LeaderboardEntry, LeaderboardSnapshot } from '../services/leaderboard-service.js';
import { LEADERBOARD_PAGE_SIZE } from '../domain/leaderboard.js';
import { getRankEmojiTag } from './rank-emojis.js';

const COMPACT_COLUMNS = {
  position: 3,
  player: 12,
  rank: 11,
  rating: 7,
  record: 7,
} as const;

export interface LeaderboardPageOptions {
  pageIndex: number;
  pageCount: number;
  applicationEmojiTags?: ReadonlyMap<string, string>;
  footerText?: string;
}

/** Render a rich, two-line-per-player page for a Components V2 text display. */
export function formatRichLeaderboardPage(
  snapshot: LeaderboardSnapshot,
  options: LeaderboardPageOptions,
): string {
  const { pageIndex, pageCount } = options;
  const entries = getPageEntries(snapshot, pageIndex);
  const emojiTags = options.applicationEmojiTags ?? new Map<string, string>();

  const lines = [
    '# 🏆 Slippi Leaderboard',
    `*${formatInteger(snapshot.registeredPlayerCount)} registered players · ` +
      'Sorted by rank, then rating*',
    ...buildStatusLines(snapshot),
    '',
    ...entries.flatMap((entry, index) => {
      const position = pageIndex * LEADERBOARD_PAGE_SIZE + index + 1;
      return formatRichEntry(entry, position, emojiTags);
    }),
    '---',
    `*${options.footerText ?? `Page ${pageIndex + 1} of ${pageCount} · ${formatOldestProfileDate(snapshot)}`}*`,
  ];

  const text = lines.join('\n');

  if (text.length > 4_000) {
    throw new RangeError(
      `Rich leaderboard page is ${text.length} characters; Discord Text Display components ` +
        'allow at most 4,000.',
    );
  }

  return text;
}

/** Render a compact, monospaced, text-only table for smaller screens. */
export function formatCompactLeaderboardPage(
  snapshot: LeaderboardSnapshot,
  options: LeaderboardPageOptions,
): string {
  const { pageIndex, pageCount } = options;
  const entries = getPageEntries(snapshot, pageIndex);
  const widths = COMPACT_COLUMNS;
  const header = [
    pad('#', widths.position, 'right'),
    pad('PLAYER', widths.player),
    pad('RANK', widths.rank),
    pad('RATING', widths.rating, 'right'),
    pad('W/L', widths.record, 'right'),
  ].join(' ');

  const rows = entries.map((entry, index) => {
    const position = pageIndex * LEADERBOARD_PAGE_SIZE + index + 1;
    const playerName = sanitizeCodeBlockText(
      entry.profile?.displayName ?? entry.registration.connectCode,
    );
    const rating = entry.profile?.rating;
    const wins = entry.profile?.wins;
    const losses = entry.profile?.losses;
    const record =
      wins === null || wins === undefined || losses === null || losses === undefined
        ? '—'
        : `${wins}/${losses}`;

    const summaryRow = [
      pad(String(position).padStart(2, '0'), widths.position, 'right'),
      pad(truncate(playerName, widths.player), widths.player),
      pad(truncate(entry.rank, widths.rank), widths.rank),
      pad(
        rating === null || rating === undefined ? '—' : formatRating(rating),
        widths.rating,
        'right',
      ),
      pad(truncate(record, widths.record), widths.record, 'right'),
    ].join(' ');

    return `${summaryRow}\n   ↳ ${sanitizeCodeBlockText(entry.registration.connectCode)}`;
  });

  const status = buildCompactStatusLines(snapshot);
  const table = ['```text', header, '-'.repeat(header.length), ...rows, '```'];
  const footer =
    options.footerText ??
    `Page ${pageIndex + 1} of ${pageCount} · ${formatOldestProfileDate(snapshot)}`;
  const text = [...status, ...(status.length > 0 ? [''] : []), ...table, '', `_${footer}_`].join(
    '\n',
  );

  if (text.length > 2_000) {
    throw new RangeError(
      `Compact leaderboard page is ${text.length} characters; Discord message content ` +
        'allows at most 2,000.',
    );
  }

  return text;
}

/** Render a non-interactive scheduled rich snapshot, limited to the first page. */
export function formatScheduledRichLeaderboard(
  snapshot: LeaderboardSnapshot,
  applicationEmojiTags: ReadonlyMap<string, string>,
): string {
  if (snapshot.registeredPlayerCount === 0) {
    return [
      '# 🏆 Slippi Leaderboard',
      'No players are registered yet. Use `/player add` to add the first player.',
      `*Scheduled weekly snapshot · ${formatOldestProfileDate(snapshot)}*`,
    ].join('\n');
  }

  return formatRichLeaderboardPage(snapshot, {
    pageIndex: 0,
    pageCount: 1,
    applicationEmojiTags,
    footerText: formatScheduledFooter(snapshot, '/leaderboard'),
  });
}

/** Render a non-interactive scheduled compact snapshot, limited to the first page. */
export function formatScheduledCompactLeaderboard(snapshot: LeaderboardSnapshot): string {
  if (snapshot.registeredPlayerCount === 0) {
    return [
      'No players are registered yet. Use /player add to add the first player.',
      `_Scheduled weekly snapshot · ${formatOldestProfileDate(snapshot)}_`,
    ].join('\n');
  }

  return formatCompactLeaderboardPage(snapshot, {
    pageIndex: 0,
    pageCount: 1,
    footerText: formatScheduledFooter(snapshot, '/leaderboard-compact'),
  });
}

function formatScheduledFooter(snapshot: LeaderboardSnapshot, fullListCommand: string): string {
  const displayedCount = Math.min(snapshot.registeredPlayerCount, LEADERBOARD_PAGE_SIZE);
  const countDescription =
    snapshot.registeredPlayerCount > displayedCount
      ? `showing top ${displayedCount} of ${formatInteger(snapshot.registeredPlayerCount)} registered players · run ${fullListCommand} for the full list`
      : `${formatInteger(snapshot.registeredPlayerCount)} registered players`;

  return `Scheduled weekly snapshot · ${countDescription} · ${formatOldestProfileDate(snapshot)}`;
}

function getPageEntries(snapshot: LeaderboardSnapshot, pageIndex: number): LeaderboardEntry[] {
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) {
    throw new RangeError('pageIndex must be a non-negative integer.');
  }

  const start = pageIndex * LEADERBOARD_PAGE_SIZE;
  return snapshot.entries.slice(start, start + LEADERBOARD_PAGE_SIZE);
}

function formatRichEntry(
  entry: LeaderboardEntry,
  position: number,
  emojiTags: ReadonlyMap<string, string>,
): string[] {
  const displayName = entry.profile?.displayName ?? entry.registration.connectCode;
  const safeName = escapeMarkdownLinkLabel(truncate(displayName, 28));
  const connectCode = entry.registration.connectCode;
  const profileUrl = getSlippiProfileUrl(connectCode);
  const emoji = getRankEmojiTag(entry.rank, emojiTags);
  const rating = entry.profile?.rating;
  const ratingText = rating === null || rating === undefined ? '—' : formatRating(rating);
  const wins = entry.profile?.wins;
  const losses = entry.profile?.losses;
  const record =
    wins === null || wins === undefined || losses === null || losses === undefined
      ? '—'
      : `${formatInteger(wins)}W / ${formatInteger(losses)}L`;
  const badge = emoji ? `${emoji} ` : '';

  return [
    `${badge}**${String(position).padStart(2, '0')} · [${safeName}](${profileUrl})**`,
    `　\`${connectCode}\` · **${entry.rank}** · ${ratingText} rating · ${record}`,
    '',
  ];
}

function buildCompactStatusLines(snapshot: LeaderboardSnapshot): string[] {
  const lines: string[] = [];

  if (snapshot.apiUnavailable) {
    lines.push(
      '[WARNING] Slippi is temporarily unavailable. ' +
        'Showing last successfully cached profiles where available.',
    );
  }

  if (snapshot.missingProfileCount > 0) {
    lines.push(`[INFO] ${snapshot.missingProfileCount} profile(s) do not have cached data yet.`);
  }

  if (snapshot.notFoundProfileCount > 0) {
    lines.push(
      `[INFO] Slippi did not return ${snapshot.notFoundProfileCount} profile(s); ` +
        'registrations were retained.',
    );
  }

  if (snapshot.staleProfileCount > 0 && !snapshot.apiUnavailable) {
    lines.push(
      `[INFO] ${snapshot.staleProfileCount} cached profile(s) are older than the ` +
        '30-minute refresh interval.',
    );
  }

  return lines;
}

function buildStatusLines(snapshot: LeaderboardSnapshot): string[] {
  const lines: string[] = [];

  if (snapshot.apiUnavailable) {
    lines.push(
      '⚠️ **Slippi is temporarily unavailable.** Showing the last successfully cached ' +
        'profile data where available.',
    );
  }

  if (snapshot.missingProfileCount > 0) {
    lines.push(`ℹ️ ${snapshot.missingProfileCount} profile(s) do not have cached data yet.`);
  }

  if (snapshot.notFoundProfileCount > 0) {
    lines.push(
      `ℹ️ Slippi did not return ${snapshot.notFoundProfileCount} profile(s); ` +
        'roster registrations were retained.',
    );
  }

  if (snapshot.staleProfileCount > 0 && !snapshot.apiUnavailable) {
    lines.push(
      `ℹ️ ${snapshot.staleProfileCount} cached profile(s) are older than the ` +
        '30-minute refresh interval.',
    );
  }

  if (snapshot.refreshedProfileCount > 0) {
    lines.push(`Updated ${snapshot.refreshedProfileCount} profile(s) from Slippi.`);
  }

  return lines;
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

function getSlippiProfileUrl(connectCode: string): string {
  const profileSlug = connectCode.replace('#', '-').toLowerCase();
  return `https://slippi.gg/user/${encodeURIComponent(profileSlug)}`;
}

function formatRating(rating: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(rating);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

function sanitizeCodeBlockText(value: string): string {
  // Backticks can terminate the surrounding code fence in compact output.
  return value.replace(/[\r\n\t]/g, ' ').replace(/`/g, 'ˋ');
}

function truncate(value: string, maxLength: number): string {
  const normalized = value.replace(/[\r\n\t]/g, ' ').trim();
  const characters = Array.from(normalized);

  if (characters.length <= maxLength) {
    return normalized;
  }

  return `${characters.slice(0, maxLength - 1).join('')}…`;
}

function pad(value: string, width: number, alignment: 'left' | 'right' = 'left'): string {
  return alignment === 'right' ? value.padStart(width) : value.padEnd(width);
}

function escapeMarkdownLinkLabel(value: string): string {
  return value.replace(/([\\`*_~|<>\[\]()])/g, '\\$1');
}
