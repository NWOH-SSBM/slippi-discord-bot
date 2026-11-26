# Slippi profile API integration

The application retrieves player profile and ranked-profile information from
Slippi's currently used internal GraphQL endpoint:

`https://internal.slippi.gg`

This endpoint and query are not a documented public API contract. They may
change without notice. `SLIPPI_GRAPHQL_ENDPOINT` can override the endpoint if
Slippi changes it, but an endpoint change may also require updating the query
and response parser in `src/services/slippi-client.ts`.

## Behavior

- Connect Codes are normalized to uppercase and syntax-validated before a
  request is sent.
- A successful profile response returns a `SlippiPlayer`.
- A GraphQL response with `data.getUser === null` means the profile was not
  found and returns `null`.
- HTTP, network, timeout, GraphQL, and malformed-response failures throw
  `SlippiApiError`; callers must not treat these as a missing player.
- Ranked fields are nullable because an account may exist without a current
  ranked profile. The client requests `ratingOrdinal`, `ratingUpdateCount`,
  `wins`, `losses`, `dailyGlobalPlacement`, `dailyRegionalPlacement`, and
  `continent` from `rankedNetplayProfile`.
- Ranked counters and placement values are validated as non-negative or
  positive integers; ratings must be finite and non-negative. An unexpected
  payload shape is treated as an API error rather than a missing player.
- Requests are serialized and spaced at least one second apart by default.
- Successful lookups and not-found results are cached for five minutes in
  process memory. Errors are not cached.

## Operational guidance

Do not automatically remove roster entries when a lookup fails or returns no
profile. A temporary API outage must never be interpreted as an empty roster.
The current `/player add` flow only persists a new entry after Slippi has
confirmed that a profile exists. On success, its profile is also written to the
persistent SQLite profile cache so the leaderboard can use it without an
immediate second API request.

The leaderboard refreshes missing or 30-minute-stale profiles sequentially.
The default client spacing is one request per second. Successful profiles are
stored in the global `slippi_profiles` cache; registrations remain scoped by
Discord guild. API failures stop that refresh pass and never overwrite cached
profiles or delete registrations.
