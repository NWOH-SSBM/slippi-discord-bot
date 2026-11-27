# Recurring leaderboard schedules

This guide covers the weekly scheduled leaderboard feature. The scheduler runs
inside the existing bot process and stores its configuration in the existing
SQLite database.

## Command reference

All schedule management is performed with `/leaderboard-schedule`. The command
is disabled for ordinary members by default using Discord's
`default_member_permissions: "0"` setting. Members with the Administrator
permission can use it. Server administrators can grant access to additional
roles or individual members in **Server Settings → Integrations → Slippi Bot
→ Manage**. The bot does not maintain its own scheduling role allowlist.

| Subcommand                     | Description                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `/leaderboard-schedule set`    | Create or replace the server's weekly schedule. Saving enables it.                    |
| `/leaderboard-schedule show`   | Display the configuration, next occurrence, and last run result.                      |
| `/leaderboard-schedule pause`  | Pause future automatic posts without deleting the schedule.                           |
| `/leaderboard-schedule resume` | Resume a paused schedule.                                                             |
| `/leaderboard-schedule remove` | Delete the schedule and stop its in-memory job.                                       |
| `/leaderboard-schedule test`   | Publish immediately to the configured channel without changing scheduled-run history. |

### Configure a schedule

`/leaderboard-schedule set` requires:

- `day`: Sunday through Saturday.
- `time`: local wall-clock time in 24-hour `HH:MM` format, for example `18:30`.
- `time-zone`: an IANA time-zone identifier, for example `America/New_York`.
- `channel`: a text or announcement channel in the same Discord server.
- `format`: `rich` or `compact`.

The time-zone option provides autocomplete suggestions. Common zones appear
first, followed by other time zones supported by the Node.js runtime. Any
valid IANA time-zone identifier can be entered. Discord does not provide a
user's time zone in command interactions, so the administrator must select it
explicitly; the bot does not infer a time zone from locale or location.

When setting a schedule, the bot verifies that it can view and send messages in
the selected channel. The bot does not need Administrator permission.

Saving a schedule replaces the existing schedule for that guild and enables
it. There is one schedule per guild, enforced by a `UNIQUE(guild_id)` database
constraint. A `schedule_name` is intentionally not stored yet. If multiple
schedules per server are needed later, add that through a versioned migration.

### Example

For a Sunday 6:30 PM Eastern post in `#leaderboard` using the rich format:

```text
/leaderboard-schedule set
  day: Sunday
  time: 18:30
  time-zone: America/New_York
  channel: #leaderboard
  format: rich
```

The response confirms the selected configuration and the next calculated
occurrence in the configured time zone.

## Persistence and scheduler lifecycle

The singular `leaderboard_schedule` table (schema version 3) stores:

- Guild and destination channel IDs.
- Weekly recurrence, weekday, local time, and IANA time zone.
- Output format and enabled/paused state.
- The Discord user who created the schedule and the most recent user who
  updated it.
- Last execution timestamp, success/failure status, and the most recent error.

The next execution time is not persisted as a UTC timestamp. It is calculated
from the saved local weekday, time, and IANA time zone. This avoids persisting
an execution instant that may become stale when time-zone rules change.

Croner 11.0.1 constructs the in-memory jobs. When Discord becomes ready, the
scheduler reads enabled rows from SQLite and recreates their jobs. Schedule
changes, pause/resume, and removal update the in-memory jobs immediately. The
scheduler owns job identity in a guild-keyed `Map`; Croner jobs are deliberately
not assigned global names. This allows a replacement job to be constructed
before the previous job is stopped, without colliding with Croner's process-wide
named-job registry.

The scheduler is process-local and assumes the project's one-Machine deployment;
do not run multiple active bot instances against the same SQLite database or
Discord application without an explicit coordination design.

### Daylight-saving behavior

Schedules follow the configured local wall-clock time across daylight-saving
changes. Croner 11.0.1's default `fixedTimeRule: "single-value"` behavior for
this fixed-time weekly expression is:

- If the configured local time does not exist during the spring-forward gap,
  the job runs at the first valid local time after the gap on that day.
- If the configured local time occurs twice during the fall-back overlap, the
  job runs once, at the first occurrence.

See the [Croner documentation](https://github.com/Hexagon/croner#readme) for
the scheduler's exact semantics and version-specific behavior.

### Missed executions and failures

Missed occurrences are skipped. If the bot is down at the scheduled time, it
does not send a catch-up post after restarting; it waits for the next weekly
occurrence.

A scheduled run:

1. Reads the current schedule row and confirms it is still enabled.
2. Obtains a leaderboard snapshot through the existing leaderboard service
   and 30-minute persistent Slippi profile cache.
3. Publishes the configured format to the configured channel.
4. Records success or failure in the schedule row.

A failed post does not disable or delete the schedule. The error is retained
for `/leaderboard-schedule show`, and the next weekly run remains scheduled.
If Slippi is unavailable, the existing leaderboard service uses the last
successful cached profile data and the scheduled output includes the stale-data
warning where appropriate. A failed Slippi refresh does not erase player
registrations or previously cached profiles.

Overlapping runs for the same guild are prevented. The `/test` subcommand uses
the same publication path but does not modify `last_run_at`, `last_run_status`,
or `last_error`. It is available even while the schedule is paused.

## Scheduled post format

Scheduled messages are static snapshots; they do not include pagination
buttons. They show up to the top 20 registered players (the same page-size
limit as the interactive commands). If the roster is larger, the footer says
that only the top 20 are shown and directs users to `/leaderboard` or
`/leaderboard-compact` for the full interactive list.

The rich format uses a Components V2 container and application-owned rank
emojis. The compact format is a plain-text monospaced table. Both use the same
leaderboard snapshot, rank calculation, sorting, cache, and stale-data status
as the manually invoked commands.

## Development testing

Use the development application's `.env` and private test guild. Do not use
production credentials for local tests.

1. Install dependencies (including Croner):

   ```bash
   npm install
   ```

2. Check and test the project:

   ```bash
   npm run check
   npm test
   npm run format:check
   ```

3. Register guild commands in the development server and start the bot:

   ```bash
   npm run commands:register
   npm run dev
   ```

4. Configure a schedule for a day/time a few minutes in the future, using the
   test guild's preferred time zone and a channel where the bot can post.
5. Run `/leaderboard-schedule show` and verify the next occurrence.
6. Run `/leaderboard-schedule test` to publish immediately without waiting for
   the scheduled time.
7. Test `pause`, `resume`, `set` (replace), and `remove`.
8. Restart the local bot and verify that the enabled schedule is restored from
   SQLite.
9. Configure a real near-future weekly occurrence and verify that it fires
   automatically once.

The schedule is persistent; the in-memory Croner job is not. Restarting the
bot should restore enabled schedules. A schedule test post does not count as a
scheduled run in the execution history.

## Production rollout

After the scheduling feature is merged and deployed to Fly, register the
updated guild command definitions against the production application and guild
from Windows Command Prompt in the repository root:

```cmd
node --env-file=.env.production --import=tsx src/register-commands.ts
```

The server administrator can then set the desired schedule through Discord.
The command is Administrator-only by default. If the administrator wants a
moderator role or specific member to manage it, they can grant that access in
Server Settings → Integrations → Slippi Bot → Manage.
