# Recurring leaderboard schedules

This document describes the first persistence increment for recurring leaderboard posts.
The scheduler and Discord command interface are implemented in subsequent increments.

## Initial behavior

- One schedule is allowed per Discord guild.
- The schedule is weekly.
- The weekday is stored as `0` (Sunday) through `6` (Saturday), matching JavaScript and
  Croner's weekday numbering.
- The local wall-clock time is stored as `HH:MM` (24-hour format).
- The time zone is stored as a canonical IANA time-zone identifier, for example
  `America/New_York`.
- The output format is either `rich` or `compact`.
- Schedules can be enabled or paused.
- The most recent execution time, result, and error are retained for administrator
  diagnostics.

## Persistence

Schema migration 3 creates the singular `leaderboard_schedule` table. Its `guild_id` column
has a unique constraint, enforcing one schedule per guild. There is intentionally no
`schedule_name` column yet. If multiple schedules per guild become useful, a future migration
can replace that uniqueness rule with a unique `(guild_id, schedule_name)` constraint.

The `created_by_discord_user_id` value records who first configured the schedule. The
`updated_by_discord_user_id` value records who most recently changed its configuration or
enabled state.

The next execution time is not persisted. It is calculated from the weekday, local time, and
IANA time zone when the scheduler starts or the schedule changes. This avoids storing a UTC
instant that becomes stale when daylight-saving rules change.

## Time-zone behavior

The application validates time zones through the Node.js `Intl.DateTimeFormat` implementation
and stores the canonical identifier returned by `resolvedOptions().timeZone`.

The schedule is intended to follow the configured local wall-clock time across daylight-saving
transitions. Croner is responsible for calculating actual execution instants from the IANA time
zone. The exact edge behavior for a scheduled time that falls inside a daylight-saving gap or
repeated hour is defined by the installed Croner version and will be documented with the
scheduler implementation.

## Missed executions

A missed occurrence is skipped. When the bot restarts, it reconstructs the job from the saved
schedule and calculates the next future occurrence; it does not replay a missed post.

## Future command surface

The planned `/leaderboard-schedule` command family is:

- `set`: create or replace the guild's schedule.
- `show`: display its configuration and next execution.
- `pause` / `resume`: disable or enable it.
- `remove`: delete it.
- `test`: publish immediately using the configured channel and format.

The scheduling command defaults to Administrator-only through Discord's application-command
permissions. Server administrators can grant additional roles or members access from
Server Settings → Integrations → the bot → Manage, without maintaining an application-specific
role allowlist.
