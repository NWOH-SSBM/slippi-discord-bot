import { Cron, type CronOptions } from 'croner';
import type { LeaderboardScheduleRepository } from '../database/leaderboard-schedule-repository.js';
import {
  toWeeklyCronExpression,
  type LeaderboardSchedule,
} from '../domain/leaderboard-schedule.js';

export interface ScheduledJob {
  nextRun(referenceDate?: Date | string | null): Date | null;
  stop(): void;
}

export type CronJobFactory = (
  expression: string,
  options: CronOptions,
  callback: () => void | Promise<void>,
) => ScheduledJob;

export type ScheduledLeaderboardPublisher = (schedule: LeaderboardSchedule) => Promise<void>;

export interface LeaderboardSchedulerOptions {
  now?: () => Date;
  createJob?: CronJobFactory;
}

const defaultCronJobFactory: CronJobFactory = (expression, options, callback) =>
  new Cron(expression, options, callback);

/**
 * Reconstructs weekly jobs from SQLite on startup. The scheduler is
 * process-local because production runs one Fly Machine against one SQLite
 * volume. Missed occurrences are not replayed after downtime.
 */
export class LeaderboardScheduler {
  private readonly jobs = new Map<string, ScheduledJob>();
  private readonly activeRuns = new Map<string, Promise<void>>();
  private readonly now: () => Date;
  private readonly createJob: CronJobFactory;
  private started = false;
  private shuttingDown = false;

  constructor(
    private readonly schedules: LeaderboardScheduleRepository,
    private readonly publish: ScheduledLeaderboardPublisher,
    options: LeaderboardSchedulerOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createJob = options.createJob ?? defaultCronJobFactory;
  }

  /** Restore all enabled schedule rows. Safe to call more than once. */
  start(): void {
    if (this.started) {
      return;
    }

    if (this.shuttingDown) {
      throw new Error('Cannot start a scheduler that has already shut down.');
    }

    this.started = true;
    const enabledSchedules = this.schedules.listEnabled();

    for (const schedule of enabledSchedules) {
      try {
        this.sync(schedule.guildId);
      } catch (error) {
        console.error(
          `Could not restore leaderboard schedule for guild ${schedule.guildId}:`,
          error,
        );
      }
    }

    console.info(`Restored ${this.jobs.size} enabled leaderboard schedule(s).`);
  }

  /** Create, replace, or stop the in-memory job for a guild's current row. */
  sync(guildId: string): void {
    if (this.shuttingDown) {
      throw new Error('Cannot modify schedules while the scheduler is shutting down.');
    }

    const schedule = this.schedules.get(guildId);
    const existingJob = this.jobs.get(guildId);

    if (!schedule || !schedule.enabled) {
      existingJob?.stop();
      this.jobs.delete(guildId);
      return;
    }

    // Build the replacement before stopping the old job. If Croner rejects a
    // configuration, the existing job remains active until the caller fixes it.
    const replacement = this.createJob(
      toWeeklyCronExpression(schedule),
      {
        timezone: schedule.timeZone,
        protect: true,
      },
      () => this.runScheduled(schedule.guildId),
    );

    existingJob?.stop();
    this.jobs.set(guildId, replacement);
  }

  /** Stop and forget a guild's in-memory job. */
  remove(guildId: string): void {
    this.jobs.get(guildId)?.stop();
    this.jobs.delete(guildId);
  }

  /** Return the next theoretical occurrence, including for a paused schedule. */
  getNextRun(schedule: LeaderboardSchedule): Date | null {
    const previewJob = this.createJob(
      toWeeklyCronExpression(schedule),
      {
        timezone: schedule.timeZone,
        paused: true,
        protect: true,
      },
      () => undefined,
    );

    try {
      return previewJob.nextRun(this.now());
    } finally {
      previewJob.stop();
    }
  }

  /** Publish on demand without modifying scheduled-run history. */
  async publishTest(guildId: string): Promise<void> {
    const schedule = this.schedules.get(guildId);

    if (!schedule) {
      throw new Error('No leaderboard schedule is configured for this server.');
    }

    await this.withRunLock(guildId, () => this.publish(schedule));
  }

  /** Stop all timers and wait for any publication already in progress. */
  async shutdown(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }

    this.shuttingDown = true;

    for (const job of this.jobs.values()) {
      job.stop();
    }

    this.jobs.clear();
    await Promise.allSettled([...this.activeRuns.values()]);
  }

  private async runScheduled(guildId: string): Promise<void> {
    if (this.shuttingDown) {
      return;
    }

    try {
      await this.withRunLock(guildId, async () => {
        // Read again at execution time so pause/remove/update actions made after
        // the timer was created are respected by a callback already in flight.
        const schedule = this.schedules.get(guildId);

        if (!schedule || !schedule.enabled) {
          return;
        }

        await this.publishAndRecord(schedule);
      });
    } catch (error) {
      if (error instanceof Error && error.message === RUN_ALREADY_IN_PROGRESS) {
        console.warn(`Skipping overlapping scheduled leaderboard run for guild ${guildId}.`);
        return;
      }

      console.error(`Scheduled leaderboard job failed unexpectedly for guild ${guildId}:`, error);
    }
  }

  private async publishAndRecord(schedule: LeaderboardSchedule): Promise<void> {
    const runAt = this.now().toISOString();
    let status: 'success' | 'failure' = 'success';
    let errorMessage: string | null = null;

    try {
      await this.publish(schedule);
    } catch (error) {
      status = 'failure';
      errorMessage = error instanceof Error ? error.message : String(error);
      console.error(
        `Scheduled leaderboard publication failed for guild ${schedule.guildId}:`,
        error,
      );
    }

    try {
      this.schedules.recordRun(schedule.guildId, status, errorMessage, runAt);
    } catch (error) {
      console.error(
        `Could not record scheduled leaderboard result for guild ${schedule.guildId}:`,
        error,
      );
    }
  }

  private async withRunLock<T>(guildId: string, operation: () => Promise<T>): Promise<T> {
    if (this.shuttingDown) {
      throw new Error('The leaderboard scheduler is shutting down.');
    }

    if (this.activeRuns.has(guildId)) {
      throw new Error(RUN_ALREADY_IN_PROGRESS);
    }

    let release!: () => void;
    const lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.activeRuns.set(guildId, lock);

    try {
      return await operation();
    } finally {
      if (this.activeRuns.get(guildId) === lock) {
        this.activeRuns.delete(guildId);
      }
      release();
    }
  }
}

const RUN_ALREADY_IN_PROGRESS = 'A leaderboard run is already in progress for this guild.';
