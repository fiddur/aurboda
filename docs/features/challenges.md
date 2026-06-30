# Challenges (federated competitions)

A **challenge** is hosted by one user and measures a single built-in metric or
activity type — as a cumulative total — over a date span. Other users **join**,
including from a **different Aurboda instance**, and the challenge page shows a race
chart + leaderboard of each member's running total.

Challenges build directly on the [sharing](./sharing.md) foundation: the same
public `/u/:username/:slug` namespace, slugged public-or-unlisted visibility, the
base-URL federation identity, and the bucketed-data engine behind dashboards.

## Model

- **Spec (v1):** one `metric` (e.g. `steps`, summed) or `activity_type` (e.g.
  strength-training hours, summed) over `[start_ts, end_ts)` in a chosen timezone.
  Scoring is the cumulative total. (Buckets are computed in UTC for v1 — totals over
  a fixed window are exact and aligned across members; timezone-local bucketing is a
  later refinement.)
- **Members** are identified by their full public base URL
  (`https://host/u/user`). The host is always a member. A member contributes data
  through a capability **data endpoint** on their own instance.
- **Same instance is just an optimization:** when a member's host is this instance,
  the aggregator reads their data in-process instead of over HTTP. One join protocol,
  one data shape.
- **Visibility:** public challenges are listed on the host's `/u/<user>` profile;
  unlisted ones are reachable only by their slug.

## URLs & storage

- A challenge lives at `<public-base>/u/<username>/<slug>` — the **same namespace**
  as shared dashboards. The public resolver `/public/:username/:slug` returns a
  `type` (`dashboard` | `challenge`); slugs are unique across both per user.
- Challenges + members live in the **host's** per-user DB; a joiner's
  *participations* live in the **joiner's** DB, each backed by an unguessable
  `data_token`. No central-DB tables.

## Federation protocol

Endpoints (under each instance's API base):

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /.well-known/aurboda` | none | Discovery: `{ product, version, federation, api_base }` |
| `GET /public/:username/:slug` | none | Resolve a slug → dashboard or challenge spec (incl. `join_token`, public member list) |
| `POST /public/:username/:slug/members` | none | Register-back: a joining instance adds itself as a remote member |
| `GET /public/:username/:slug/standings` | none (slug-gated) | Host-aggregated standings (`?refresh=1` busts the cache) |
| `GET /challenge-data/:username/:token` | none (token) | A member instance serves its own series for one challenge |

**Join (canonical: "join by challenge URL on your own instance B", host = A):**

1. B reads `<A-base>/.well-known/aurboda` to verify A is an Aurboda host + locate its API.
2. B fetches the spec from `<A-api>/public/<user>/<slug>`.
3. B records a local participation (spec snapshot + random `data_token`), making
   `GET <B-api>/challenge-data/<user>/<token>` live.
4. B registers back to `<A-api>/public/<user>/<slug>/members` with its identity,
   display name, data-endpoint URL, and the `join_token`.
5. A validates the token, probes the endpoint, and stores the member.

The same-server "Join" button and the challenge page's "enter your host" prompt both
funnel into this. When B === A, steps 1–5 collapse to a direct local membership.

**Standings:** the host pulls each remote member's data endpoint (5-minute TTL cache,
persisted per member; a failed fetch falls back to last-known data flagged `stale`)
and computes local members in-process.

## Security & trust

- The unguessable slug + capability tokens are the gates; data endpoints are
  **host-only secrets** (never in any public response).
- `join_token` proves a joiner actually fetched the spec; the host probes the data
  endpoint before accepting and can remove members. Leaving deletes the participation
  so the endpoint 404s.
- **Trust model:** a member's instance is trusted to report honest numbers
  (Strava-style). A malicious self-hoster could serve fabricated values — accepted
  for now; instance-key signed requests are a future hardening.

## Deployment note

`GET /.well-known/aurboda` must be reachable at the **web base URL** an operator
gives out (e.g. `https://aurboda.net/.well-known/aurboda`). Route `/.well-known/*`
to the backend in the reverse proxy (standard for federation). Dev instances that hit
the backend directly need no extra config.

## API surface (authed, owner/joiner)

`/challenges` — `GET` (list hosted), `POST` (create), `GET/PUT/DELETE /:id`,
`GET /:id/standings`, `GET /:id/members`, `DELETE /:id/members/:memberId`,
`GET /challenges/participations/mine`, `POST /challenges/join`,
`DELETE /challenges/participations/:id`. The same CRUD + join is available over MCP
(`create/list/update/delete_challenge`, `join_challenge`).

## Out of scope (v1)

Background polling, timezone-local bucketing, goals/consistency/teams, signed
instance-key auth.
