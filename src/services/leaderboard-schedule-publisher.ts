import {
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  TextDisplayBuilder,
  type Client,
} from 'discord.js';
import type { LeaderboardSchedule } from '../domain/leaderboard-schedule.js';
import type { LeaderboardService } from './leaderboard-service.js';
import {
  formatScheduledCompactLeaderboard,
  formatScheduledRichLeaderboard,
} from '../presentation/leaderboard-format.js';

const COMPONENT_ACCENT_COLOR = 0x5865f2;

/** Publishes a static scheduled snapshot to its configured guild channel. */
export class LeaderboardSchedulePublisher {
  constructor(
    private readonly client: Client,
    private readonly leaderboard: LeaderboardService,
    private readonly applicationEmojiTags: ReadonlyMap<string, string>,
  ) {}

  async publish(schedule: LeaderboardSchedule): Promise<void> {
    const channel = await this.client.channels.fetch(schedule.channelId);

    if (!channel) {
      throw new Error(`Scheduled leaderboard channel ${schedule.channelId} no longer exists.`);
    }

    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
      throw new Error('Scheduled leaderboard destination must be a text or announcement channel.');
    }

    if (channel.guildId !== schedule.guildId) {
      throw new Error('Scheduled leaderboard destination belongs to a different Discord server.');
    }

    const botMember = channel.guild.members.me ?? (await channel.guild.members.fetchMe());
    const permissions = channel.permissionsFor(botMember);

    if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
      throw new Error(
        `The bot needs View Channel and Send Messages permissions in #${channel.name}.`,
      );
    }

    const snapshot = await this.leaderboard.getLeaderboard(schedule.guildId);

    if (schedule.format === 'rich') {
      const container = new ContainerBuilder()
        .setAccentColor(COMPONENT_ACCENT_COLOR)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            formatScheduledRichLeaderboard(snapshot, this.applicationEmojiTags),
          ),
        );

      await channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      });
      return;
    }

    await channel.send({
      content: formatScheduledCompactLeaderboard(snapshot),
      allowedMentions: { parse: [] },
    });
  }
}
