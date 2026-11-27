import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { Cron } from 'croner';
import { openDatabase } from '../dist/database/database.js';
import { LeaderboardScheduleRepository } from '../dist/database/leaderboard-schedule-repository.js';
import { LeaderboardScheduler } from '../dist/services/leaderboard-scheduler.js';

const baseInput = {
  guildId: 'guild-1',
  channelId: 'channel-1',
  dayOfWeek: 0,
  localTime: '18:30',
  timeZone: 'America/New_York',
  format: 'rich',
  actorDiscordUserId: 'admin-1',
};

function createFixture(options = {}) {
  const database = openDatabase(':memory:');
  const schedules = new LeaderboardScheduleRepository(database);
  const jobs = [];
  const published = [];
  const errors = [];
  const now = options.now ?? (() => new Date('2026-11-26T12:00:00.000Z'));
  const publisher = options.publish ?? (async (schedule) => published.push(schedule));
  const createJob =
    options.createJob ??
    ((expression, jobOptions, callback) => {
      const job = {
        expression,
        options: jobOptions,
        callback,
        stopped: false,
        nextRun(referenceDate) {
          return new Date(referenceDate ?? now());
        },
        stop() {
          this.stopped = true;
        },
      };
      jobs.push(job);
      return job;
    });
  const scheduler = new LeaderboardScheduler(schedules, publisher, { now, createJob });

  return { database, schedules, jobs, published, errors, scheduler };
}

function closeFixture(fixture) {
  fixture.database.close();
}

test('restores enabled schedules and creates each job with its local time zone', () => {
  const fixture = createFixture();
  try {
    fixture.schedules.save(baseInput);
    fixture.scheduler.start();
    fixture.scheduler.start();

    assert.equal(fixture.jobs.length, 1);
    assert.equal(fixture.jobs[0].expression, '0 30 18 * * 0');
    assert.equal(fixture.jobs[0].options.timezone, 'America/New_York');
    assert.equal(fixture.jobs[0].options.protect, true);
    // The scheduler owns job identity in its guild-keyed Map. Croner names
    // are globally unique within a process and are unnecessary here.
    assert.equal(fixture.jobs[0].options.name, undefined);
  } finally {
    closeFixture(fixture);
  }
});

test('sync replaces the old job and stops jobs for paused or removed schedules', () => {
  const fixture = createFixture();
  try {
    fixture.schedules.save(baseInput);
    fixture.scheduler.start();
    const original = fixture.jobs[0];

    fixture.schedules.save({ ...baseInput, localTime: '19:45', actorDiscordUserId: 'admin-2' });
    fixture.scheduler.sync('guild-1');
    const replacement = fixture.jobs[1];

    assert.equal(original.stopped, true);
    assert.equal(replacement.expression, '0 45 19 * * 0');

    fixture.schedules.setEnabled('guild-1', false, 'admin-2');
    fixture.scheduler.sync('guild-1');
    assert.equal(replacement.stopped, true);

    fixture.schedules.setEnabled('guild-1', true, 'admin-2');
    fixture.scheduler.sync('guild-1');
    const resumed = fixture.jobs[2];
    fixture.schedules.remove('guild-1');
    fixture.scheduler.sync('guild-1');
    assert.equal(resumed.stopped, true);
  } finally {
    closeFixture(fixture);
  }
});

test('real Croner replaces an existing guild job without a duplicate-name conflict', async () => {
  const createdJobs = [];
  const fixture = createFixture({
    createJob: (expression, options, callback) => {
      const job = new Cron(expression, options, callback);
      createdJobs.push(job);
      return job;
    },
  });

  try {
    fixture.schedules.save(baseInput);
    fixture.scheduler.start();

    assert.equal(createdJobs.length, 1);
    const original = createdJobs[0];

    fixture.schedules.save({
      ...baseInput,
      localTime: '19:45',
      actorDiscordUserId: 'admin-2',
    });

    assert.doesNotThrow(() => fixture.scheduler.sync('guild-1'));
    assert.equal(createdJobs.length, 2);
    assert.equal(original.isStopped(), true);
    assert.equal(createdJobs[1].isRunning(), true);
    assert.equal(createdJobs[1].getPattern(), '0 45 19 * * 0');
  } finally {
    await fixture.scheduler.shutdown();
    closeFixture(fixture);
  }
});

test('getNextRun creates a paused preview job and returns its next occurrence', () => {
  const fixture = createFixture();
  try {
    const schedule = fixture.schedules.save(baseInput);
    const nextRun = fixture.scheduler.getNextRun(schedule);

    assert.ok(nextRun instanceof Date);
    assert.equal(fixture.jobs[0].options.paused, true);
    assert.equal(fixture.jobs[0].options.name, undefined);
    assert.equal(fixture.jobs[0].stopped, true);
  } finally {
    closeFixture(fixture);
  }
});

test('scheduled execution publishes and records a successful run', async () => {
  const fixture = createFixture();
  try {
    fixture.schedules.save(baseInput);
    fixture.scheduler.start();

    await fixture.jobs[0].callback();

    assert.equal(fixture.published.length, 1);
    const saved = fixture.schedules.get('guild-1');
    assert.equal(saved.lastRunStatus, 'success');
    assert.equal(saved.lastError, null);
    assert.equal(saved.lastRunAt, '2026-11-26T12:00:00.000Z');
  } finally {
    closeFixture(fixture);
  }
});

test('scheduled publication failures are recorded without disabling the schedule', async () => {
  const fixture = createFixture({
    publish: async () => {
      throw new Error('Discord destination is unavailable.');
    },
  });
  try {
    fixture.schedules.save(baseInput);
    fixture.scheduler.start();

    await fixture.jobs[0].callback();

    const saved = fixture.schedules.get('guild-1');
    assert.equal(saved.lastRunStatus, 'failure');
    assert.equal(saved.lastError, 'Discord destination is unavailable.');
    assert.equal(saved.enabled, true);
  } finally {
    closeFixture(fixture);
  }
});

test('test publication does not modify scheduled-run history', async () => {
  const fixture = createFixture();
  try {
    const schedule = fixture.schedules.save(baseInput);
    await fixture.scheduler.publishTest('guild-1');

    assert.equal(fixture.published.length, 1);
    assert.equal(fixture.schedules.get('guild-1').lastRunAt, null);
    assert.equal(fixture.schedules.get('guild-1').lastRunStatus, null);
    assert.equal(schedule.enabled, true);
  } finally {
    closeFixture(fixture);
  }
});

test('overlapping scheduled and test publications for one guild are prevented', async () => {
  let releasePublication;
  const publication = new Promise((resolve) => {
    releasePublication = resolve;
  });
  let publishCount = 0;
  const fixture = createFixture({
    publish: async () => {
      publishCount += 1;
      await publication;
    },
  });
  try {
    fixture.schedules.save(baseInput);
    fixture.scheduler.start();

    const scheduledRun = fixture.jobs[0].callback();
    await assert.rejects(fixture.scheduler.publishTest('guild-1'), /already in progress/);
    assert.equal(publishCount, 1);

    releasePublication();
    await scheduledRun;
  } finally {
    closeFixture(fixture);
  }
});

test('scheduled callbacks re-read state and skip a schedule paused after job creation', async () => {
  const fixture = createFixture();
  try {
    fixture.schedules.save(baseInput);
    fixture.scheduler.start();
    fixture.schedules.setEnabled('guild-1', false, 'admin-2');

    await fixture.jobs[0].callback();

    assert.equal(fixture.published.length, 0);
    assert.equal(fixture.schedules.get('guild-1').lastRunAt, null);
  } finally {
    closeFixture(fixture);
  }
});

test('shutdown stops timer jobs and waits for in-flight publication', async () => {
  let releasePublication;
  const publication = new Promise((resolve) => {
    releasePublication = resolve;
  });
  const fixture = createFixture({
    publish: async () => publication,
  });
  try {
    fixture.schedules.save(baseInput);
    fixture.scheduler.start();
    const scheduledRun = fixture.jobs[0].callback();
    await Promise.resolve();

    const shutdown = fixture.scheduler.shutdown();
    assert.equal(fixture.jobs[0].stopped, true);

    let shutdownFinished = false;
    void shutdown.then(() => {
      shutdownFinished = true;
    });
    await Promise.resolve();
    assert.equal(shutdownFinished, false);

    releasePublication();
    await Promise.all([scheduledRun, shutdown]);
    assert.equal(shutdownFinished, true);
  } finally {
    closeFixture(fixture);
  }
});

test('real Croner calculates the next matching local wall-clock occurrence', async () => {
  const fixture = createFixture({
    createJob: (expression, options, callback) => new Cron(expression, options, callback),
  });
  try {
    const schedule = fixture.schedules.save(baseInput);
    const nextRun = fixture.scheduler.getNextRun(schedule);
    assert.ok(nextRun instanceof Date);

    const parts = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: 'America/New_York',
    }).formatToParts(nextRun);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));

    assert.equal(values.weekday, 'Sunday');
    assert.equal(values.hour, '18');
    assert.equal(values.minute, '30');
    assert.ok(nextRun.getTime() > Date.parse('2026-11-26T12:00:00.000Z'));
  } finally {
    closeFixture(fixture);
  }
});
