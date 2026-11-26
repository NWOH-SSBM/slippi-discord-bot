# Slippi Discord Bot

A Discord bot for maintaining and displaying a community leaderboard of Super
Smash Bros. Melee players using Slippi Connect Codes and ranked profile data.

> **Project status:** Core functionality is implemented and being prepared for
> its first production deployment. See the roadmap below for remaining work.

## Commands

| Command                         | Description                                                                            | Initial access |
| ------------------------------- | -------------------------------------------------------------------------------------- | -------------- |
| `/leaderboard`                  | Rich leaderboard with rank badges, profile links, Connect Codes, ratings, and records. | Everyone       |
| `/leaderboard-compact`          | Compact text-only leaderboard for smaller screens.                                     | Everyone       |
| `/player add <connect-code>`    | Register a Slippi Connect Code.                                                        | Everyone       |
| `/player remove <connect-code>` | Remove a registered Connect Code.                                                      | Everyone       |

Connect Codes may use the official `TAG#123` separator (#) or a single space or
hyphen in its place. Values are normalized to the canonical `TAG#123` format.

Command access is intentionally open in the initial release. Authorization
should be implemented behind a replaceable policy so that moderator-only
restrictions can be added later without rewriting command logic.

## Architecture decisions

| Concern              | Decision                                                                 |
| -------------------- | ------------------------------------------------------------------------ |
| Language             | TypeScript                                                               |
| Runtime              | Node.js 26 LTS                                                           |
| Discord library      | `discord.js`                                                             |
| Discord connection   | Gateway connection; slash commands and component interactions            |
| Gateway intents      | `Guilds` only unless a future feature proves another intent is necessary |
| Database             | SQLite via `better-sqlite3`                                              |
| Profile cache        | Persistent SQLite cache with a 30-minute refresh interval                |
| Deployment           | Docker on Fly.io                                                         |
| Runtime topology     | One always-on Machine; no replicas initially                             |
| Persistent data      | SQLite database on a Fly Volume mounted at `/data`                       |
| Command registration | Guild-scoped for the initial community server                            |
| License              | GNU GPL version 3.0 only (`GPL-3.0-only`)                                |

The bot does not need a public inbound HTTP endpoint. It initiates outbound
connections to Discord and Slippi.

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

2. Copy `.env.example` to `.env` and fill in the values:

   ```bash
   cp .env.example .env
   ```

3. Build and run the bot:

   ```bash
   npm run build
   npm start
   ```

   Or run in watch mode:

   ```bash
   npm run dev
   ```

4. Register slash commands to the configured development guild:

   ```bash
   npm run commands:register
   ```

Guild commands are preferred during development because updates are available
quickly and remain scoped to the test server. Do not register global commands
until there is a deliberate decision to do so.

## Rank artwork

The rich leaderboard uses Discord application-owned custom emojis for Slippi
rank badges. These are image-based Discord emojis, not Unicode emoji
approximations. See [the presentation guide](docs/leaderboard-presentation.md)
and [the asset attribution notice](assets/ranks/ASSET-NOTICES.md).

To prepare the local rank images and upload them to the currently configured
Discord application:

```bash
npm run assets:import
npm run emojis:sync
```

The import step downloads upstream SVG artwork from a pinned Project Slippi
revision and converts it to transparent 128 × 128 PNG files. The sync step
creates any missing application emojis. Restart the bot after syncing so it
loads the new emoji map. Run the sync separately for the production application
using its credentials; development and production applications do not share
emoji collections.

## Configuration

| Variable                  | Required | Description                                                           |
| ------------------------- | -------- | --------------------------------------------------------------------- |
| `DISCORD_TOKEN`           | Yes      | Bot token from the Discord Developer Portal. Secret; never commit it. |
| `DISCORD_CLIENT_ID`       | Yes      | Discord application ID.                                               |
| `DISCORD_GUILD_ID`        | Yes      | Server ID used for guild-scoped command registration.                 |
| `DATABASE_PATH`           | No       | SQLite database path. Defaults to `./data/slippi-discord-bot.sqlite`. |
| `SLIPPI_GRAPHQL_ENDPOINT` | No       | Slippi GraphQL endpoint; defaults to `internal.slippi.gg`.            |

For local development, Node loads `.env` using its built-in
`--env-file-if-exists` option through the npm scripts. In production, inject
variables through Fly secrets and set
`DATABASE_PATH=/data/slippi-discord-bot.sqlite`.

## Security and operational principles

- Never commit `.env`, bot tokens, Fly access tokens, or deployment credentials.
- Request only the Discord permissions and Gateway intents needed by implemented features.
- Do not grant the bot Administrator permission.
- Keep the bot process non-root in its container.
- Use a persistent volume for the SQLite database; container filesystems are not durable storage.
- Maintain a recoverable database backup outside the Machine/volume failure domain.
- Do not run multiple active bot instances against the same SQLite file or Discord application without an explicit coordination design.
- Treat Slippi API responses as external and potentially unavailable: apply timeouts and validate response shapes.
- Suppress unintended mentions and escape profile-controlled display names before rendering Markdown.

## Development workflow

- Create feature branches; do not push directly to `main` during normal development.
- Open pull requests against `main`.
- Require one approving review and resolution of review comments.
- Run CI checks before merge.
- Keep production secrets out of external pull-request workflows.
- Organization administrators may use the configured ruleset bypass when a second reviewer is unavailable; prefer PRs where practical.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution expectations.

## Roadmap

### 1. Repository and application foundation

- [x] Public repository and GPL-3.0 license
- [x] Protected `main` branch and GitHub security features configured
- [x] TypeScript project scaffold and CI checks
- [x] Discord development application and guild-scoped command registration

### 2. Core functionality

- [x] SQLite schema and repository layer
- [x] Slippi API client with timeout and response validation
- [x] Add and remove registered players
- [x] Persistent profile cache and leaderboard rank calculation
- [x] Leaderboard retrieval, sorting, pagination, and presentation
- [x] Duplicate and invalid Connect Code handling
- [x] Useful handling for partial Slippi/API failures
- [x] Unit tests for domain logic and repository behavior
- [ ] Rich and compact leaderboard presentation polish
- [ ] Application-owned rank emoji assets and attribution

### 3. Production deployment

- [ ] Docker image and Fly.io application configuration
- [ ] Persistent Fly Volume mounted at `/data`
- [ ] Production secrets and guild ID configured
- [ ] Single-Machine restart/recovery configuration
- [ ] Automated deployment from approved changes on `main`
- [ ] Backup and restore procedure
- [ ] External uptime/heartbeat monitoring

### 4. Community rollout and maintenance

- [ ] Install bot in the community Discord server
- [ ] Configure channel access and command permissions
- [ ] Acceptance testing with server administrators
- [ ] Document operational ownership and recovery
- [ ] Gather community feedback before expanding scope

## License

This project is licensed under the GNU General Public License, version 3.0
only. See [LICENSE](LICENSE).
