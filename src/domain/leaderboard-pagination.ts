const LEADERBOARD_BUTTON_PREFIX = 'slippi-lb:';
const LEGACY_BUTTON_PREFIX = 'leaderboard:';

export type LeaderboardButtonAction = 'previous' | 'next';

export interface ParsedLeaderboardButtonCustomId {
  sessionId: string;
  action: LeaderboardButtonAction;
}

export function createLeaderboardButtonCustomId(
  sessionId: string,
  action: LeaderboardButtonAction,
): string {
  return `${LEADERBOARD_BUTTON_PREFIX}${sessionId}:${action}`;
}

/** Recognize current buttons and legacy IDs so old messages can be acknowledged. */
export function isLeaderboardButtonCustomId(customId: string): boolean {
  return (
    customId.startsWith(LEADERBOARD_BUTTON_PREFIX) || customId.startsWith(LEGACY_BUTTON_PREFIX)
  );
}

export function isLegacyLeaderboardButtonCustomId(customId: string): boolean {
  return customId.startsWith(LEGACY_BUTTON_PREFIX);
}

export function parseLeaderboardButtonCustomId(
  customId: string,
): ParsedLeaderboardButtonCustomId | undefined {
  const [prefix, sessionId, action, extra] = customId.split(':');

  if (
    prefix !== LEADERBOARD_BUTTON_PREFIX.slice(0, -1) ||
    !sessionId ||
    (action !== 'previous' && action !== 'next') ||
    extra !== undefined
  ) {
    return undefined;
  }

  return { sessionId, action };
}
