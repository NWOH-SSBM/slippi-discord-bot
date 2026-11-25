# Slippi Discord Bot

A Discord bot for maintaining and displaying a community leaderboard of Super Smash Bros. Melee players using Slippi Connect Codes and rating information.

> **Project status:** Initial development. The application scaffold and slash-command registration are being established; the leaderboard and player-management behavior are not implemented yet.

## Goals

- Provide a simple, reliable leaderboard for one local Melee community.
- Allow community members to add and remove registered players.
- Retrieve player profile and rating information from Slippi.
- Keep persistent state in a small SQLite database.
- Run continuously as a single lightweight Fly.io Machine.
- Keep the project public and contributions available under GPL-3.0.
- Minimize operational overhead and recurring hosting cost.

## Initial commands

| Command                         | Description                                         | Initial access |
| ------------------------------- | --------------------------------------------------- | -------------- |
| `/leaderboard`                  | Display registered players ranked by Slippi rating. | Everyone       |
| `/player add <connect-code>`    | Register a Slippi Connect Code.                     | Everyone       |
| `/player remove <connect-code>` | Remove a registered Connect Code.                   | Everyone       |

Command access is intentionally open in the initial release. Authorization should be implemented behind a replaceable policy so that moderator-only restrictions can be added later without rewriting command logic.

## Architecture decisions

| Concern              | Decision                                                                 |
| -------------------- | ------------------------------------------------------------------------ |
| Language             | TypeScript                                                               |
| Runtime              | Node.js 26 LTS                                                           |
| Discord library      | `discord.js`                                                             |
| Discord connection   | Gateway connection; slash commands only                                  |
| Gateway intents      | `Guilds` only unless a future feature proves another intent is necessary |
| Database             | SQLite via `better-sqlite3`                                              |
| Deployment           | Docker on Fly.io                                                         |
| Runtime topology     | One always-on Machine; no replicas initially                             |
| Persistent data      | SQLite database on a Fly Volume mounted at `/data`                       |
| Command registration | Guild-scoped for the initial community server                            |
| License              | GNU GPL version 3.0 (GPL-3.0-only)                                       |

The bot does not need a public inbound HTTP endpoint. It initiates outbound connections to Discord and Slippi.

## Requirements

- Node.js 26.x
- npm (included with Node.js)
- A Discord application with a bot user
- A Discord test server for development

## Local development

1. Install dependencies and create the lockfile:

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

Guild commands are preferred during development because updates are available quickly and remain scoped to the test server. Do not register global commands until there is a deliberate decision to do so.

## Configuration

| Variable            | Required | Description                                                                     |
| ------------------- | -------- | ------------------------------------------------------------------------------- |
| `DISCORD_TOKEN`     | Yes      | Bot token from the Discord Developer Portal. Secret; never commit it.           |
| `DISCORD_CLIENT_ID` | Yes      | Discord application ID.                                                         |
| `DISCORD_GUILD_ID`  | Yes      | Development or production server ID used for guild-scoped command registration. |
| `DATABASE_PATH`     | No       | SQLite database path. Defaults to `./data/slippi-discord-bot.sqlite`.           |

For local development, Node loads `.env` using its built-in `--env-file-if-exists` option through the npm scripts. In production, inject variables through Fly secrets and set `DATABASE_PATH=/data/slippi-discord-bot.sqlite`.

## Security and operational principles

- Never commit `.env`, bot tokens, Fly access tokens, or deployment credentials.
- Request only the Discord permissions and Gateway intents needed by implemented features.
- Do not grant the bot Administrator permission.
- Keep the bot process non-root in its container.
- Use a persistent volume for the SQLite database; container filesystems are not durable storage.
- Maintain a recoverable database backup outside the Machine/volume failure domain.
- Do not run multiple active bot instances against the same SQLite file or Discord application without explicitly designing coordination and failover.
- Treat Slippi API responses as external, potentially unavailable input: apply timeouts, validate response shapes, and provide useful partial-failure messages.

## Development workflow

- Create feature branches; do not push directly to `main` during normal development.
- Open pull requests against `main`.
- Require one approving review and resolution of review comments.
- Run CI checks before merge.
- Keep production secrets out of pull-request workflows, especially workflows triggered by external contributors.
- Organization administrators may use the configured ruleset bypass for maintenance when a second reviewer is unavailable; prefer the normal PR path where practical.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution expectations.

## Roadmap

### 1. Repository and application foundation

- [x] Public repository and GPL-3.0 license
- [x] Protected `main` branch and GitHub security features configured
- [ ] TypeScript project scaffold and CI checks
- [ ] Discord application configuration
- [ ] Guild-scoped slash-command registration

### 2. Core functionality

- [ ] SQLite schema and repository layer
- [ ] Slippi API client with timeout and response validation
- [ ] Add and remove registered players
- [ ] Leaderboard retrieval, sorting, and presentation
- [ ] Duplicate and invalid Connect Code handling
- [ ] Useful handling for partial Slippi/API failures
- [ ] Unit tests for domain logic and repository behavior

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

This project is licensed under the GNU General Public License, version 3.0 only. See [LICENSE](LICENSE).
