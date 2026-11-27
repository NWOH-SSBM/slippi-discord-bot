import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidLocalTime,
  isWeekday,
  normalizeLeaderboardScheduleInput,
  normalizeTimeZone,
  toWeeklyCronExpression,
} from '../dist/domain/leaderboard-schedule.js';

const validInput = {
  guildId: ' guild-1 ',
  channelId: ' channel-1 ',
  dayOfWeek: 0,
  localTime: '18:30',
  timeZone: 'America/New_York',
  format: 'rich',
  actorDiscordUserId: ' user-1 ',
};

test('normalizes schedule identifiers and canonicalizes the time zone', () => {
  const normalized = normalizeLeaderboardScheduleInput(validInput);

  assert.equal(normalized.guildId, 'guild-1');
  assert.equal(normalized.channelId, 'channel-1');
  assert.equal(normalized.actorDiscordUserId, 'user-1');
  assert.equal(normalized.timeZone, 'America/New_York');
  assert.equal(normalized.localTime, '18:30');
});

test('validates 24-hour local times', () => {
  assert.equal(isValidLocalTime('00:00'), true);
  assert.equal(isValidLocalTime('23:59'), true);
  assert.equal(isValidLocalTime('24:00'), false);
  assert.equal(isValidLocalTime('7:30'), false);
  assert.equal(isValidLocalTime('18:60'), false);
  assert.equal(isValidLocalTime('18.30'), false);
});

test('validates Sunday-through-Saturday weekday values', () => {
  assert.equal(isWeekday(0), true);
  assert.equal(isWeekday(6), true);
  assert.equal(isWeekday(-1), false);
  assert.equal(isWeekday(7), false);
  assert.equal(isWeekday(1.5), false);
});

test('normalizes valid IANA time zones and rejects unknown zones', () => {
  assert.equal(normalizeTimeZone('UTC'), 'UTC');
  assert.equal(normalizeTimeZone('America/New_York'), 'America/New_York');
  assert.throws(() => normalizeTimeZone('Mars/Olympus_Mons'), /Invalid IANA time zone/);
});

test('rejects invalid schedule fields', () => {
  assert.throws(
    () => normalizeLeaderboardScheduleInput({ ...validInput, localTime: '6pm' }),
    /24-hour HH:MM/,
  );
  assert.throws(
    () => normalizeLeaderboardScheduleInput({ ...validInput, dayOfWeek: 7 }),
    /day must be an integer/,
  );
  assert.throws(
    () => normalizeLeaderboardScheduleInput({ ...validInput, format: 'html' }),
    /format must be/,
  );
  assert.throws(
    () => normalizeLeaderboardScheduleInput({ ...validInput, timeZone: 'Not/A_Timezone' }),
    /Invalid IANA time zone/,
  );
});

test('generates a six-field weekly Croner expression', () => {
  const schedule = normalizeLeaderboardScheduleInput(validInput);

  assert.equal(toWeeklyCronExpression(schedule), '0 30 18 * * 0');
});
