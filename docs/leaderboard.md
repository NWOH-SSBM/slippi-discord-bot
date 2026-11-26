# Leaderboard and rank calculation

## Profile cache

The bot stores the last successfully retrieved Slippi profile in SQLite's
`slippi_profiles` table. The cache is keyed by normalized Connect Code rather
than guild ID, allowing multiple guild rosters to reuse the same upstream
profile later.

The cache stores Slippi-provided fields, not a computed rank:

- display name
- rating ordinal
- rating update count
- wins and losses
- daily global and regional placement
- continent
- timestamp of the last successful fetch

Profiles are refreshed when `/leaderboard` runs and a cache entry is missing or
at least 30 minutes old. Refresh requests are sequential and use the Slippi
client's request-spacing policy (one request per second by default). A cold
cache of many players can therefore take time to fill; the command defers its
Discord response and reports refresh progress. If Slippi returns an API error,
refresh stops for that invocation. Existing cached records and player
registrations are not deleted or overwritten by failures. A short process-local
retry delay prevents repeated commands from immediately retrying during an outage.

New profiles are cached when `/player add` successfully verifies and registers
a Connect Code.

## Placement and rank rules

Rank calculation is isolated in `src/domain/rank.ts`; it does not make HTTP
requests and does not depend on Discord.

The currently adopted rating thresholds are:

| Rank       | Minimum rating |
| ---------- | -------------: |
| Bronze 1   |              0 |
| Bronze 2   |         765.43 |
| Bronze 3   |         913.72 |
| Silver 1   |       1,054.87 |
| Silver 2   |       1,188.88 |
| Silver 3   |       1,315.75 |
| Gold 1     |       1,435.48 |
| Gold 2     |       1,548.07 |
| Gold 3     |       1,653.52 |
| Platinum 1 |       1,751.83 |
| Platinum 2 |       1,843.00 |
| Platinum 3 |       1,927.03 |
| Diamond 1  |       2,003.92 |
| Diamond 2  |       2,073.67 |
| Diamond 3  |       2,136.28 |
| Master 1   |       2,191.75 |
| Master 2   |       2,275.00 |
| Master 3   |       2,350.00 |

Placement is derived from the ranked game record:

- Zero wins and zero losses: `Unranked`.
- One through four total ranked games: `Pending`.
- Five or more total ranked games: use the rating thresholds above.

This uses `wins + losses` as the total ranked game count. The implementation
is based on the public Philly Melee leaderboard utility source, which filters
profiles below five total games and uses the same static thresholds:

- https://github.com/phillymelee/phillymelee.github.io/blob/ea785cf6a1d4fe9464cdfaa9256b3666c57059c8/firebase/functions/src/utils.ts
- https://www.reddit.com/r/SSBM/comments/zl6g0z/elo_required_for_each_rank_on_slippi_ranked/

Grandmaster is treated as a dynamic rank. A profile is assigned Grandmaster
when its rating is at least 2,191.75 and Slippi returns a positive integer
`dailyGlobalPlacement`. A community implementation reports that this field is
available for players in Slippi's global top-300 placement set. We rely on the
upstream placement signal rather than reimplementing the global ranking
calculation. This is community-observed behavior, not a published API contract:

- https://github.com/phillymelee/phillymelee.github.io/blob/ea785cf6a1d4fe9464cdfaa9256b3666c57059c8/firebase/functions/src/utils.ts

These thresholds and placement rules are community-observed behavior, not a
versioned public Slippi API contract. Project Slippi's own launcher is useful
for understanding official application behavior and architecture, while the
explicit threshold table and placement logic above are taken from the linked
community implementation. If Slippi changes them, update the rank resolver
and its boundary tests.

Reference repositories and implementations:

- Project Slippi launcher: https://github.com/project-slippi/slippi-launcher
- Philly Melee rank and placement utility: https://github.com/phillymelee/phillymelee.github.io/blob/ea785cf6a1d4fe9464cdfaa9256b3666c57059c8/firebase/functions/src/utils.ts

## Leaderboard ordering

Entries are ordered by:

1. Rank descending: Grandmaster, Master 3 through Bronze 1, Pending, Unranked,
   then profiles awaiting data.
2. Rating descending within the same rank.
3. Display name alphabetically, case-insensitively.
4. Connect Code alphabetically as a deterministic final tie-breaker.

Both `/leaderboard` and `/leaderboard-compact` display 20 entries per page and
use the same `LeaderboardService` snapshot and ordering. The rich command uses
Discord Components V2 with rank artwork, Connect Codes, and clickable Slippi
profile names. The compact command uses a monospaced text-only table.

Pagination buttons are restricted to the user who invoked the command. They
use a process-local session store with a 30-minute inactivity expiry rather
than temporary per-message collectors. See
[leaderboard presentation](leaderboard-presentation.md) for the interaction
lifecycle, expiry behavior, rank emoji synchronization, and rendering details.

## Connect Code input

The canonical stored format remains `TAG#CODE`. For convenience, a single
ASCII space or hyphen may be entered in place of `#`; inputs are normalized to
the canonical format before validation, storage, comparison, or Slippi lookup.
