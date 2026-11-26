/** Sunday is zero to match JavaScript Date#getDay() and Croner's weekday field. */
export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type LeaderboardFormat = 'rich' | 'compact';
export type LeaderboardScheduleFrequency = 'weekly';
export type ScheduleRunStatus = 'success' | 'failure';

export interface SaveLeaderboardScheduleInput {
  guildId: string;
  channelId: string;
  dayOfWeek: Weekday;
  localTime: string;
  timeZone: string;
  format: LeaderboardFormat;
  actorDiscordUserId: string;
}

export interface NormalizedLeaderboardScheduleInput extends SaveLeaderboardScheduleInput {
  guildId: string;
  channelId: string;
  localTime: string;
  timeZone: string;
  actorDiscordUserId: string;
}

export interface LeaderboardSchedule {
  id: number;
  guildId: string;
  channelId: string;
  frequency: LeaderboardScheduleFrequency;
  dayOfWeek: Weekday;
  localTime: string;
  timeZone: string;
  format: LeaderboardFormat;
  enabled: boolean;
  createdByDiscordUserId: string;
  updatedByDiscordUserId: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  lastRunStatus: ScheduleRunStatus | null;
  lastError: string | null;
}

/** Validate and normalize values before persistence or scheduling. */
export function normalizeLeaderboardScheduleInput(
  input: SaveLeaderboardScheduleInput,
): NormalizedLeaderboardScheduleInput {
  const guildId = normalizeIdentifier(input.guildId, 'Guild ID');
  const channelId = normalizeIdentifier(input.channelId, 'Channel ID');
  const actorDiscordUserId = normalizeIdentifier(input.actorDiscordUserId, 'Discord user ID');
  const localTime = input.localTime.trim();

  if (!isValidLocalTime(localTime)) {
    throw new RangeError('Schedule time must use 24-hour HH:MM format.');
  }

  if (!isWeekday(input.dayOfWeek)) {
    throw new RangeError('Schedule day must be an integer from 0 (Sunday) through 6 (Saturday).');
  }

  if (input.format !== 'rich' && input.format !== 'compact') {
    throw new RangeError('Leaderboard format must be "rich" or "compact".');
  }

  const timeZone = normalizeTimeZone(input.timeZone);

  return {
    guildId,
    channelId,
    dayOfWeek: input.dayOfWeek,
    localTime,
    timeZone,
    format: input.format,
    actorDiscordUserId,
  };
}

export function isValidLocalTime(value: string): boolean {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    return false;
  }

  return true;
}

export function isWeekday(value: number): value is Weekday {
  return Number.isInteger(value) && value >= 0 && value <= 6;
}

/**
 * Validate an IANA time-zone identifier and return the runtime's canonical
 * spelling. Intl uses the platform's IANA time-zone database and requires no
 * extra date/time dependency.
 */
export function normalizeTimeZone(value: string): string {
  const timeZone = value.trim();

  if (!timeZone || timeZone.length > 64) {
    throw new RangeError('Time zone must contain between 1 and 64 characters.');
  }

  try {
    return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
  } catch {
    throw new RangeError(`Invalid IANA time zone: ${timeZone}`);
  }
}

/**
 * Convert a validated weekly local schedule to a six-field Croner expression:
 * second minute hour day-of-month month day-of-week.
 */
export function toWeeklyCronExpression(
  schedule: Pick<LeaderboardSchedule, 'dayOfWeek' | 'localTime'>,
): string {
  const [hour, minute] = schedule.localTime.split(':').map(Number);

  if (
    hour === undefined ||
    minute === undefined ||
    !isValidLocalTime(schedule.localTime) ||
    !isWeekday(schedule.dayOfWeek)
  ) {
    throw new RangeError('Cannot create a cron expression from an invalid weekly schedule.');
  }

  return `0 ${minute} ${hour} * * ${schedule.dayOfWeek}`;
}

function normalizeIdentifier(value: string, label: string): string {
  const normalized = value.trim();

  if (!normalized || normalized.length > 64) {
    throw new RangeError(`${label} must contain between 1 and 64 characters.`);
  }

  return normalized;
}
