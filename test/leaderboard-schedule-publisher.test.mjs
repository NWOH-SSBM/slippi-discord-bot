import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, MessageFlags } from 'discord.js';
import { LeaderboardSchedulePublisher } from '../dist/services/leaderboard-schedule-publisher.js';

const schedule = {
  id: 1,
  guildId: 'guild-1',
  channelId: 'channel-1',
  frequency: 'weekly',
  dayOfWeek: 0,
  localTime: '18:30',
  timeZone: 'America/New_York',
  format: 'rich',
  enabled: true,
  createdByDiscordUserId: 'admin-1',
  updatedByDiscordUserId: 'admin-1',
  createdAt: '2026-11-26T00:00:00.000Z',
  updatedAt: '2026-11-26T00:00:00.000Z',
  lastRunAt: null,
  lastRunStatus: null,
  lastError: null,
};

function createSnapshot(count = 1, overrides = {}) {
  return {
    entries: Array.from({ length: count }, (_, index) => ({
      registration: {
        guildId: 'guild-1',
        connectCode: `PLAY#${String(index).padStart(3, '0')}`,
        addedByDiscordUserId: 'user-1',
        addedAt: '2026-11-26T00:00:00.000Z',
      },
      profile: {
        connectCode: `PLAY#${String(index).padStart(3, '0')}`,
        displayName: `Player ${index + 1}`,
        rating: 1800,
        ratingUpdateCount: 20,
        wins: 10,
        losses: 5,
        dailyGlobalPlacement: null,
        dailyRegionalPlacement: null,
        continent: 'North America',
        fetchedAt: '2026-11-26T12:00:00.000Z',
      },
      rank: 'Platinum 1',
    })),
    registeredPlayerCount: count,
    refreshedProfileCount: 0,
    notFoundProfileCount: 0,
    staleProfileCount: 0,
    missingProfileCount: 0,
    apiUnavailable: false,
    ...overrides,
  };
}

function createPublisher({
  format = 'rich',
  channelOverrides = {},
  snapshot = createSnapshot(),
} = {}) {
  const sent = [];
  const channel = {
    id: 'channel-1',
    name: 'leaderboard',
    type: ChannelType.GuildText,
    guildId: 'guild-1',
    guild: { members: { me: { id: 'bot-1' }, fetchMe: async () => ({ id: 'bot-1' }) } },
    permissionsFor: () => ({ has: () => true }),
    send: async (payload) => {
      sent.push(payload);
      return { id: 'message-1' };
    },
    ...channelOverrides,
  };
  const client = { channels: { fetch: async () => channel } };
  const leaderboard = { getLeaderboard: async () => snapshot };
  const publisher = new LeaderboardSchedulePublisher(client, leaderboard, new Map());

  return { publisher, sent, channel };
}

test('publishes a rich Components V2 snapshot to the configured text channel', async () => {
  const { publisher, sent } = createPublisher();

  await publisher.publish(schedule);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].flags, MessageFlags.IsComponentsV2);
  assert.equal(sent[0].components.length, 1);
  assert.equal(sent[0].allowedMentions.parse.length, 0);
  assert.match(sent[0].components[0].toJSON().components[0].content, /Slippi Leaderboard/);
});

test('publishes a compact plain-text snapshot', async () => {
  const { publisher, sent } = createPublisher({ format: 'compact' });

  await publisher.publish({ ...schedule, format: 'compact' });

  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /```text/);
  assert.equal(sent[0].components, undefined);
  assert.equal(sent[0].allowedMentions.parse.length, 0);
});

test('rejects a destination channel that no longer exists', async () => {
  const { publisher } = createPublisher();
  publisher['client'].channels.fetch = async () => null;

  await assert.rejects(publisher.publish(schedule), /no longer exists/);
});

test('rejects a destination channel in another guild', async () => {
  const { publisher, channel } = createPublisher();
  channel.guildId = 'different-guild';

  await assert.rejects(publisher.publish(schedule), /different Discord server/);
});

test('rejects a destination where the bot cannot view and send messages', async () => {
  const { publisher, channel } = createPublisher();
  channel.permissionsFor = () => ({ has: () => false });

  await assert.rejects(publisher.publish(schedule), /View Channel and Send Messages/);
});

test('rejects unsupported destination channel types', async () => {
  const { publisher, channel } = createPublisher();
  channel.type = ChannelType.GuildVoice;

  await assert.rejects(publisher.publish(schedule), /text or announcement channel/);
});
