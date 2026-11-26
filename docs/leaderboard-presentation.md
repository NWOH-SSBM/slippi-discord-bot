# Leaderboard presentation

## Commands

- `/leaderboard` displays the rich Components V2 leaderboard with rank badges,
  clickable Slippi profile links, Connect Codes, rating, and ranked record.
- `/leaderboard-compact` displays a fixed-width, text-only table for users who
  prefer a denser layout, particularly on smaller screens.

Both commands use the same `LeaderboardService` snapshot, ordering, 20-player
page size, and profile cache. They differ only in their presentation renderer.

## Rich presentation

The rich command uses a Components V2 container with a text display. Rank
artwork is shown as inline Discord application-owned custom emojis: custom image
assets uploaded to the Discord application and referenced by emoji ID. These are
not Unicode characters or approximations such as 💎/👑. Although source PNGs
are 128 × 128 pixels, Discord renders custom emojis inline at roughly text-line
size rather than at their full source dimensions. This keeps 20 players per page
within Components V2 message limits. If an application emoji has not been synced,
the row remains readable and displays the textual rank without an icon.

Display names are escaped before being inserted into Markdown link labels.
The links point to the corresponding Slippi profile. All command and component
responses set `allowedMentions` to prevent profile-controlled text from
triggering mentions.

## Compact presentation

The compact command renders a monospaced table inside a text code block. It
keeps the player, rank, Connect Code, rating, and W/L record in bounded-width
columns. Player names and rank labels are truncated to keep the table readable
on smaller displays. It intentionally remains text-only and does not render
rank emojis or clickable player links.

## Pagination lifecycle

Pagination uses a process-local `LeaderboardSessionStore`, not per-message
`MessageComponentCollector` instances. Each paginated response gets a unique
snapshot ID in its button custom IDs. The store retains the snapshot, display
format, invoking user ID, and current page for a 30-minute inactivity window.

The global `interactionCreate` handler acknowledges all leaderboard button
interactions. It checks session expiry and the original invoking user before
updating the message. Buttons from expired sessions or messages created before
the global handler was introduced receive a private message asking the user to
run the relevant leaderboard command again. A bot restart clears in-memory
sessions; old buttons remain safe to click and receive the same expiration
response. On the first stale click, the handler attempts to remove the old
controls from the message and then sends the user a private expiration notice.
If Discord refuses the message update, the failed update is logged and the
private notice is still attempted.

The store is bounded to 100 sessions. It does not persist session state to
SQLite because page navigation is transient UI state, not community data.

## Rank emojis

Rank SVGs are imported from the pinned Project Slippi `slippi-launcher`
revision documented in [the rank asset notice](../assets/ranks/ASSET-NOTICES.md).
The original SVGs are retained under `assets/ranks/source-svg/`; 128 × 128
transparent PNGs suitable for Discord application emojis are generated under
`assets/ranks/png/`.

Run `npm run assets:import` to download the pinned SVGs and create PNGs. Then
run `npm run emojis:sync` to upload missing images to the Discord application
identified by the current `DISCORD_TOKEN` and `DISCORD_CLIENT_ID` values. Stop
the local bot before synchronization because the script opens a Gateway session
using the same token.
The sync script is additive: it skips application emojis that already exist by
name and does not delete or rename any application emoji.

Run the sync script once for the development application and once for the
production application using that application's credentials. The bot fetches
its application emoji collection at startup and uses the emoji names to render
rank badges. If fetching fails, textual rank labels remain available.

The source artwork is a build/release asset. The production Docker runtime does
not need the `sharp` dependency or original SVG files; only the generated
application emojis are used at runtime.
