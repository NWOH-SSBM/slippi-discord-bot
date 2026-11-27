import test from 'node:test';
import assert from 'node:assert/strict';
import { commandDefinitions } from '../dist/commands/definitions.js';
import { handleLeaderboardScheduleAutocomplete } from '../dist/commands/leaderboard-schedule.js';

const scheduleCommand = commandDefinitions.find(
  (definition) => definition.name === 'leaderboard-schedule',
);

function getScheduleCommand() {
  assert.ok(scheduleCommand);
  return scheduleCommand.toJSON();
}

test('leaderboard schedule command is disabled for non-admin members by default', () => {
  assert.equal(getScheduleCommand().default_member_permissions, '0');
});

test('leaderboard schedule exposes the expected subcommands', () => {
  const subcommands = getScheduleCommand().options.map((option) => option.name);
  assert.deepEqual(subcommands, ['set', 'show', 'pause', 'resume', 'remove', 'test']);
});

test('schedule set requires weekday, local time, time zone, channel, and format', () => {
  const setCommand = getScheduleCommand().options.find((option) => option.name === 'set');
  const options = Object.fromEntries(setCommand.options.map((option) => [option.name, option]));

  assert.deepEqual(Object.keys(options).sort(), ['channel', 'day', 'format', 'time', 'time-zone']);
  assert.ok(Object.values(options).every((option) => option.required));
  assert.equal(options['time-zone'].autocomplete, true);
  assert.equal(options.time.min_length, 5);
  assert.equal(options.time.max_length, 5);
  assert.deepEqual(options.channel.channel_types, [0, 5]);
  assert.deepEqual(
    options.format.choices.map((choice) => choice.value),
    ['rich', 'compact'],
  );
  assert.equal(options.day.choices.length, 7);
});

test('time-zone autocomplete prioritizes common zones and stays within Discord limits', async () => {
  let response;
  const interaction = {
    options: { getFocused: () => ({ name: 'time-zone', value: '' }) },
    respond: async (choices) => {
      response = choices;
    },
  };

  await handleLeaderboardScheduleAutocomplete(interaction);

  assert.equal(response.length, 25);
  assert.equal(response[0].value, 'UTC');
  assert.equal(response[1].value, 'America/New_York');
  assert.ok(response.some((choice) => choice.value === 'America/Chicago'));
});

test('time-zone autocomplete filters the common and supported IANA zones', async () => {
  let response;
  const interaction = {
    options: { getFocused: () => ({ name: 'time-zone', value: 'america/new' }) },
    respond: async (choices) => {
      response = choices;
    },
  };

  await handleLeaderboardScheduleAutocomplete(interaction);

  assert.ok(response.length > 0);
  assert.ok(response.every((choice) => choice.value.toLowerCase().includes('america/new')));
});

test('autocomplete ignores non-time-zone focused options', async () => {
  let response;
  const interaction = {
    options: { getFocused: () => ({ name: 'day', value: 1 }) },
    respond: async (choices) => {
      response = choices;
    },
  };

  await handleLeaderboardScheduleAutocomplete(interaction);
  assert.deepEqual(response, []);
});
