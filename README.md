# Slippi Discord Bot

A Discord bot for maintaining and displaying a community leaderboard of Super
Smash Bros. Melee players using Slippi Connect Codes and ranked profile data.

> **Project status:** The bot is live in the community Discord server. The
> recurring weekly leaderboard schedule feature is being developed on a feature
> branch and is not yet deployed to production. See [Production status and
> maintenance](#production-status-and-maintenance).

Repository: [NWOH-SSBM/slippi-discord-bot](https://github.com/NWOH-SSBM/slippi-discord-bot)

## Features

- Maintain a guild-specific roster of Slippi Connect Codes.
- Retrieve player display names, ranked ratings, and win/loss records from Slippi.
- Calculate Bronze, Silver, Gold, Platinum, Diamond, Master, and Grandmaster ranks.
- Cache the last successful Slippi profile data in SQLite.
- Display a rich leaderboard with rank artwork, clickable Slippi profile names,
  Connect Codes, ratings, and records.
- Display a compact, text-only leaderboard for smaller screens.
- Paginate leaderboard results, with 20 players per page.
- Keep player registrations when Slippi is temporarily unavailable and clearly
  indicate when cached profile information is stale.
- Configure one recurring weekly leaderboard post per Discord server, with a
  local time, IANA time zone, destination channel, and rich or compact format.

The Slippi profile endpoint used by the bot is an internal GraphQL API, not a
stable public API contract. The client validates responses and handles
timeouts and service failures. If Slippi is unavailable, the bot does not
treat that failure as a missing player or delete registrations.

## Commands

| Command                         | Description                                                                             | Initial access           |
| ------------------------------- | --------------------------------------------------------------------------------------- | ------------------------ |
| `/leaderboard`                  | Rich leaderboard with rank artwork, profile links, Connect Codes, ratings, and records. | Everyone                 |
| `/leaderboard-compact`          | Compact text-only leaderboard for smaller screens.                                      | Everyone                 |
| `/player add <connect-code>`    | Register a Slippi Connect Code after validating the profile.                            | Everyone                 |
| `/player remove <connect-code>` | Remove a registered Connect Code.                                                       | Everyone                 |
| `/leaderboard-schedule`         | Configure, inspect, pause, resume, remove, or test the server's weekly post.            | Administrator by default |

Connect Codes may use the official `TAG#123` separator (`#`) or a single
space or hyphen in its place. Values are normalized to the canonical
`TAG#123` format.

Player registration and removal are intentionally open in the initial
release: anyone can currently add or remove any registered player. The
schedule-management command is Administrator-only by default; server
administrators can grant additional roles or members access through Discord's
Integration command permissions.

## Leaderboard behavior

### Rich leaderboard

`/leaderboard` uses Discord Components V2 and application-owned custom emojis
for the Slippi rank badges. It displays:

- Player position.
- Rank badge and rank name.
- Clickable Slippi display name/profile link.
- Canonical Connect Code.
- Ranked rating.
- Ranked wins and losses.

### Compact leaderboard

`/leaderboard-compact` provides a text-only, monospaced presentation intended
for users on smaller screens or users who prefer a denser table.

### Ranking and sorting

Players are ordered by rank descending:

1. Grandmaster
2. Master 3, Master 2, Master 1
3. Diamond 3, Diamond 2, Diamond 1
4. Platinum 3, Platinum 2, Platinum 1
5. Gold 3, Gold 2, Gold 1
6. Silver 3, Silver 2, Silver 1
7. Bronze 3, Bronze 2, Bronze 1
8. Pending / Unranked

Within a rank, players are ordered by numerical rating descending. Display name
is used as a deterministic tie-breaker.

The rank resolver is separate from the GraphQL client. Static rating thresholds
are maintained in application code. Players with fewer than five total ranked
games (`wins + losses`) are treated as pending placement. Grandmaster
qualification uses the rating threshold and Slippi's global placement signal.
These rules reflect observed Slippi behavior and community implementations;
they are not a versioned guarantee from an official public API.

### Profile cache and service outages

Successful Slippi profile responses are stored persistently in SQLite. The
cache refresh interval is 30 minutes. Rank is calculated from the cached
profile fields when the leaderboard is rendered, so rank threshold changes do
not require a profile-cache migration.

When Slippi is temporarily unavailable, the bot retains the last successful
profile data and indicates that the displayed data is stale. Failed or
malformed responses do not overwrite a valid cached profile.

### Pagination

Leaderboards show 20 players per page. Pagination component interactions are
handled centrally rather than by a short-lived per-message collector.

Leaderboard page state is held in memory. Old buttons become invalid when
their session expires or when the bot restarts; clicking them should return an
ephemeral message explaining that the user must run the leaderboard command
again. The underlying player roster and profile cache remain in SQLite.

## Recurring leaderboard posts

The scheduling feature is currently on the `feature/leaderboard-schedule`
branch and is not yet part of the production `main` deployment. Once merged,
each Discord server can configure one weekly post with
`/leaderboard-schedule set`:

- `day`: Sunday through Saturday.
- `time`: local wall-clock time in 24-hour `HH:MM` format.
- `time-zone`: an IANA identifier such as `America/New_York` (autocomplete is
  provided; the bot does not infer a user's time zone from Discord).
- `channel`: a text or announcement channel in the same server.
- `format`: `rich` or `compact`.

The `set` subcommand creates or replaces that server's one schedule and enables
it. `show` reports its configuration, next occurrence, and last run result.
`pause` and `resume` control future automatic posts without deleting the
configuration. `remove` deletes it. `test` publishes immediately to the
configured channel, even if the schedule is paused, without changing scheduled
run history.

Scheduled posts are static snapshots of the top 20 registered players and do
not include pagination buttons. They retain the selected rich or compact
presentation, rank artwork where applicable, profile links, Connect Codes,
ratings, records, and stale-cache warnings. Members can use the normal
leaderboard commands to browse the full roster interactively.

The singular `leaderboard_schedule` SQLite table has a unique constraint on
`guild_id`, enforcing one schedule per server. No `schedule_name` is stored.
The table is introduced by schema migration 3; see the [data model guide](docs/data-model.md)
for all tables and migration details.
The next occurrence is calculated from the saved weekday, local time, and IANA
time zone; a UTC timestamp is not persisted. Croner 11.0.1 reconstructs
in-memory jobs from enabled rows when the bot becomes ready. Its fixed-time DST
behavior is: a missing local time during spring-forward runs at the first valid
time after the gap, and a repeated local time during fall-back runs once at its
first occurrence. See the [scheduling guide](docs/leaderboard-scheduling.md)
for lifecycle and operational details.

Missed occurrences are skipped after downtime; the bot does not backfill
posts. A failed publication is recorded in the schedule row but does not
remove or disable the schedule. The next weekly occurrence remains scheduled.
The scheduler runs inside the existing Node.js process and uses the same
SQLite database; no second Machine or external scheduling service is required.

## Architecture decisions

| Concern              | Decision                                                       |
| -------------------- | -------------------------------------------------------------- |
| Language             | TypeScript                                                     |
| Runtime              | Node.js 26 LTS                                                 |
| Discord library      | `discord.js`                                                   |
| Discord connection   | Gateway connection; slash commands and component interactions  |
| Gateway intents      | `Guilds` only                                                  |
| Database             | SQLite via `better-sqlite3`                                    |
| Player registrations | Guild-specific; Connect Code is canonicalized                  |
| Profile cache        | Persistent SQLite cache with a 30-minute refresh interval      |
| Slippi integration   | Isolated GraphQL client using `fetch`                          |
| Rank calculation     | Separate rank resolver                                         |
| Leaderboard UI       | Discord Components V2; rich and compact layouts                |
| Scheduled jobs       | Croner 11.0.1; weekly local-time schedule with IANA time zones |
| Schedule persistence | Singular `leaderboard_schedule`; one row per guild             |
| Rank artwork         | Discord application-owned custom emojis                        |
| Deployment           | Docker on Fly.io                                               |
| Runtime topology     | One always-on Machine; no replicas                             |
| Persistent data      | SQLite database on a Fly Volume mounted at `/data`             |
| Command registration | Guild-scoped for the community server                          |
| License              | GNU GPL version 3.0 only (`GPL-3.0-only`)                      |

The bot does not need a public inbound HTTP endpoint. It initiates outbound
connections to Discord and Slippi.

The initial database design supports more than one guild, but the deployment
and command registration are currently intended for one community server.
Do not run multiple active bot instances against the same SQLite database or
Discord application without an explicit coordination design.

## Requirements

- Node.js 26.x
- npm (included with Node.js)
- A Discord application with a bot user
- A Discord test server for development

## Local development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in the development application and
   test-server values:

   ```bash
   cp .env.example .env
   ```

   On Windows Command Prompt:

   ```cmd
   copy .env.example .env
   ```

3. Run checks:

   ```bash
   npm run check
   npm test
   npm run format:check
   ```

4. Build and run the bot:

   ```bash
   npm run build
   npm start
   ```

   Or run in watch mode:

   ```bash
   npm run dev
   ```

5. Register slash commands to the configured development guild:

   ```bash
   npm run commands:register
   ```

Guild commands are preferred during development because updates are available
quickly and remain scoped to the test server. Do not register global commands
until there is a deliberate decision to do so.

The local `.env` is used by the development npm scripts. Keep production
credentials in a separate local `.env.production` file; this file must remain
ignored by Git.

## Rank artwork

The rich leaderboard uses Discord application-owned custom emojis for Slippi
rank badges. These are image-based custom emojis, not Unicode emoji
approximations. The source SVG artwork is imported from a pinned Project
Slippi Launcher revision and converted into transparent 128 × 128 PNG assets.

See:

- [Leaderboard presentation guide](docs/leaderboard-presentation.md)
- [Rank asset attribution notice](assets/ranks/ASSET-NOTICES.md)

To prepare the local rank images:

```bash
npm run assets:import
```

To upload missing emojis to the application configured by the local `.env`:

```bash
npm run emojis:sync
```

Development and production Discord applications have separate emoji
collections. Synchronize each application separately. For production, use the
production environment explicitly:

```cmd
node --env-file=.env.production scripts/sync-application-emojis.mjs
```

The production bot should be stopped while the synchronization script uses
the production bot token, then restarted. Restarting the bot after syncing
causes it to load the updated application emoji map.

Review `assets/ranks/ASSET-NOTICES.md` and the upstream license/asset notices
before modifying or redistributing artwork.

## Configuration

| Variable                  | Required | Description                                                           |
| ------------------------- | -------- | --------------------------------------------------------------------- |
| `DISCORD_TOKEN`           | Yes      | Bot token from the Discord Developer Portal. Secret; never commit it. |
| `DISCORD_CLIENT_ID`       | Yes      | Discord application ID.                                               |
| `DISCORD_GUILD_ID`        | Yes      | Server ID used for guild-scoped command registration.                 |
| `DATABASE_PATH`           | No       | SQLite database path. Defaults to `./data/slippi-discord-bot.sqlite`. |
| `SLIPPI_GRAPHQL_ENDPOINT` | No       | Slippi GraphQL endpoint; defaults to `https://internal.slippi.gg`.    |

For local development, npm scripts load `.env`. In production, inject
`DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `DISCORD_GUILD_ID` through Fly
secrets, and set:

```text
NODE_ENV=production
DATABASE_PATH=/data/slippi-discord-bot.sqlite
SLIPPI_GRAPHQL_ENDPOINT=https://internal.slippi.gg
```

Do not commit `.env`, `.env.production`, or any other file containing
credentials.

## GitHub repository and contribution workflow

Repository: [NWOH-SSBM/slippi-discord-bot](https://github.com/NWOH-SSBM/slippi-discord-bot)

- The repository is public and licensed under GPL-3.0-only.
- `main` is protected by a repository ruleset.
- Changes should be made on feature branches and submitted through pull
  requests.
- One approving review and review-thread resolution are required.
- CI checks must pass before merging.
- A `CODEOWNERS` file identifies code ownership.
- Organization administrators have a ruleset bypass for situations where a
  second reviewer is unavailable; prefer pull requests and review where
  practical.
- Dependabot alerts and updates, CodeQL, and secret protection/push protection
  are enabled.
- Production deployment credentials must never be exposed to pull-request
  workflows or external contributors.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution expectations.

## Production deployment

### Current Fly.io environment

The production application is deployed to Fly.io.

| Setting                            | Current configuration             |
| ---------------------------------- | --------------------------------- |
| Fly app                            | `nwoh-slippi-discord-bot-prod`    |
| Region                             | `ord` (Chicago)                   |
| Machine count                      | One                               |
| Machine size                       | `shared-cpu-1x`, 256 MB RAM       |
| Volume                             | `data`, 1 GB                      |
| Mount point                        | `/data`                           |
| Restart policy                     | `always`                          |
| Public inbound application service | None                              |
| Database path                      | `/data/slippi-discord-bot.sqlite` |

The production Docker image has built and deployed successfully. The Machine
has connected to the production Discord Gateway, initialized SQLite on the
mounted volume, and loaded the 21 application-owned rank emojis.

The production Discord application is installed in the community server.
Production guild commands have been registered, and the core commands have
been acceptance-tested. The weekly scheduling feature remains on its feature
branch until it passes local and CI tests, is merged, and deploys to Fly.
After that deployment, production guild commands must be re-registered to add
`/leaderboard-schedule`.

### Fly secrets

The following values are configured as Fly secrets:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID`

The production Discord token is never stored in the repository or GitHub
Actions. The GitHub Actions deployment token (`FLY_API_TOKEN`), when used, is
a separate app-scoped Fly deploy token.

### Windows Command Prompt operations

The following commands are intended for Windows Command Prompt (`cmd.exe`).
Run them from the repository root.

Set the application variable for the current CMD session:

```cmd
set "FLY_APP=nwoh-slippi-discord-bot-prod"
```

Inspect the deployment:

```cmd
fly status --app %FLY_APP%
fly machine list --app %FLY_APP%
fly volumes list --app %FLY_APP%
fly logs --app %FLY_APP%
```

Deploy the current checkout:

```cmd
fly deploy --remote-only --app %FLY_APP%
```

List configured secret names and deployment status (secret values are not
shown):

```cmd
fly secrets list --app %FLY_APP%
```

Connect to the Machine for diagnostics:

```cmd
fly ssh console --app %FLY_APP%
```

The app-scoped `FLY_API_TOKEN` is intended for CI/CD only and should not be
confused with the production Discord bot token.

### Production command registration

Slash commands are guild-scoped. Register them only after the production bot
has been installed into the community server.

From Windows Command Prompt, in the repository root:

```cmd
node --env-file=.env.production --import=tsx src/register-commands.ts
```

This explicitly loads production credentials rather than the development
`.env` file. Do not run the ordinary development registration command when
you intend to register production commands.

### Community server installation

The server administrator must install the production application using the
Discord installation link supplied by the project maintainer.

The bot should receive only the permissions it needs:

- View Channels
- Send Messages
- Embed Links

Do not grant Administrator permission. The application uses the `Guilds`
Gateway intent only; Server Members, Presence, and Message Content privileged
intents are not required.

After installation:

1. Verify the bot appears in the server member list.
2. Confirm it can access the intended channel(s).
3. Register the production guild commands using the command above.
4. Test both leaderboard commands.
5. Test player registration and removal.
6. Verify rank emojis, profile links, Connect Codes, and pagination.
7. Confirm that the server administrator is comfortable with the initial
   open access policy for player add/remove commands.

## Production status and maintenance

### Completed

- [x] Public repository, GPL-3.0-only license, protected `main`, and `CODEOWNERS`
- [x] TypeScript project scaffold and passing CI quality checks
- [x] Dependabot, CodeQL, and secret push protection configured
- [x] Development Discord application and test guild
- [x] SQLite schema, migrations, and repository layer
- [x] Slippi GraphQL client with timeout and response validation
- [x] Player add/remove commands
- [x] Persistent Slippi profile cache and rank calculation
- [x] Rich Components V2 and compact leaderboard commands
- [x] Rank artwork import, attribution, and 21 application emojis
- [x] Clickable Slippi profile names and Connect Code display
- [x] Pagination interaction handling and expired-session response
- [x] Docker image successfully built and deployed to Fly.io
- [x] Production Fly Machine running in `ord`
- [x] Encrypted 1 GB Fly Volume attached at `/data`
- [x] Production Discord secrets deployed to Fly
- [x] Production bot connected to Discord Gateway
- [x] Production application rank emojis synchronized and loaded
- [x] Production SQLite database initialized on the Fly Volume
- [x] Production bot installed in the community server
- [x] Production guild commands registered and core commands acceptance-tested
- [x] GitHub Actions deploy job runs after successful quality checks on `main`

### Recurring schedule feature branch

- [x] Schema version 3 and `leaderboard_schedule` repository
- [x] Weekly local-time scheduling domain and validation
- [x] Croner scheduler with startup restoration and graceful shutdown
- [x] Discord `/leaderboard-schedule` command family (Administrator by default)
- [x] Rich/compact static scheduled-post publishing, top 20 only
- [x] Manual test publication and execution-history reporting
- [ ] Complete local Node.js 26 checks and schedule acceptance testing
- [ ] Merge the scheduling feature and allow GitHub Actions to deploy it
- [ ] Re-register production guild commands to publish `/leaderboard-schedule`
- [ ] Configure and test the desired production weekly schedule

### Deferred operational improvements

These items are intentionally deferred; they are not blockers for initial
launch:

- [ ] Off-provider automated SQLite backups and a restore procedure.
- [ ] External uptime/heartbeat monitoring.
- [ ] Review actual Fly memory usage after the bot has run in production; raise
      the Machine to 512 MB if measured usage warrants it.
- [ ] Revisit moderator-only permissions for player add/remove if community
      feedback indicates a need.
- [ ] Consider additional Discord servers or features only when there is a
      concrete requirement.

The project currently accepts the risk of losing the production Fly Volume.
If that happens, the local community roster and cached profiles can be
repopulated. Fly volume snapshots may help with recovery, but they are not
treated as an independent off-provider backup.

## Security and operational principles

- Never commit `.env`, `.env.production`, bot tokens, Fly access tokens, or
  deployment credentials.
- Request only the Discord permissions and Gateway intents needed by
  implemented features.
- Do not grant the bot Administrator permission.
- Keep the bot process non-root in its container.
- Use the Fly Volume for SQLite; container filesystems are not durable storage.
- Independent off-provider database backups are deferred by project decision;
  data loss is accepted for the initial small community deployment.
- Do not run multiple active bot instances against the same SQLite file or
  Discord application without an explicit coordination design.
- Treat Slippi API responses as external and potentially unavailable: apply
  timeouts and validate response shapes.
- Preserve successful cached profile data when Slippi is unavailable.
- Persist schedule definitions in SQLite and reconstruct Croner jobs at startup.
- Run only one active bot Machine against the SQLite database; no distributed
  scheduler/locking design is implemented.
- Suppress unintended mentions and escape profile-controlled display names
  before rendering Discord messages.
- Keep production Discord secrets on Fly and deployment credentials in the
  GitHub production environment only.

## License

This project is licensed under the GNU General Public License, version 3.0
only. See [LICENSE](LICENSE).
