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
  ranked profile.
- Requests are serialized and spaced at least one second apart by default.
- Successful lookups and not-found results are cached for five minutes in
  process memory. Errors are not cached.

## Operational guidance

Do not automatically remove roster entries when a lookup fails or returns no
profile. A temporary API outage must never be interpreted as an empty roster.
The current `/player add` flow only persists a new entry after Slippi has
confirmed that a profile exists.
