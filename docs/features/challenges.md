# Challenges (federated competitions)

Start a challenge to compete with friends: most steps this week, most kilometres this month, most
hours of strength training, or most push-ups in one set. Everyone who joins, on this server or on
another Aurboda server, shows up on a live race chart and leaderboard, and the only thing a member
shares is that one measure over the challenge's dates. Create, join and share challenges from
**Challenges** in the sidebar; [Using it in the web app](#using-it-in-the-web-app) has the details,
and the rest of this page describes how it works.

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
  Scoring is the cumulative total. Chart buckets (days, weeks, hours) follow the
  **challenge's** timezone — the host's choice, copied into each member's
  participation — not each member's own, so every member's days line up. An unknown
  timezone falls back to UTC.
- **Measure spec:** an `activity_type` spec can instead score a
  [list-item measure](./activity-types.md#exercises-and-measures) of each session
  (`spec.measure`), optionally over one item value (`filter_field` = an item path such as
  `sets.exercise`, `filter_value` = `Push-ups`, compared trimmed and case-insensitively).
  Each bucket is the measure aggregated over the bucket's sessions by `aggregation`.
  "Most push-ups in a month" is `total_reps` with `sum` (the score is the summed reps, as
  for any cumulative challenge); "most push-ups in one set" is `max_reps` with `max`.
  `max` needs a measure, and scores a member by their **best bucket** rather than the
  sum, so the race chart plots the running best instead of a running total. A session
  without the filtered exercise is not data: it adds nothing and does not move
  `last_updated`.
- **Spec frozen once a remote member joins:** a member from another instance keeps the
  spec it joined with in its participation, so a host may not change the spec under it
  (#1324). Once the challenge has an active remote member, `PUT /challenges/:id` and the
  `update_challenge` MCP tool refuse a `spec` that differs from the stored one (REST
  `409`); an unchanged `spec` in the body passes. Name, dates, timezone, visibility and
  `announce_winner` stay editable. Members on the host's own instance are scored from the
  current spec, so they do not freeze it.
- **Members** are identified by their full public base URL
  (`https://host/u/user`). The host is always a member. A member contributes data
  through a capability **data endpoint** on their own instance.
- **Same instance is just an optimization:** when a member's host is this instance,
  the aggregator reads their data in-process instead of over HTTP. One join protocol,
  one data shape.
- **Visibility:** the `visibility` field is the shared `ShareVisibility` vocabulary
  (`public`/`unlisted`) also used by shared dashboards and the feed (see
  [Sharing](./sharing.md)). `public` challenges are listed on the host's `/u/<user>`
  profile; `unlisted` ones are reachable only by their slug. Stored as an `is_public`
  boolean and mapped at the API boundary.
- **Chart granularity (`spec.bucket_size`):** controls only the race chart's
  resolution — never the score (the cumulative total is bucket-size-independent).
  `auto` (default) adapts to the window so short challenges show intraday progress and
  long ones stay readable/cheap: ≤1d → 5-minute, ≤3d → 15-minute, ≤14d → 1-hour,
  ≤120d → daily, else weekly. A creator can instead fix a coarser bucket
  (`1d`/`1w`/`1M`) for very long challenges. The resolved size is exposed to viewers as
  `effective_bucket_size` on the public challenge; because it derives purely from the
  window, every instance resolves the same size, so members' series stay aligned.
- **Banner (optional):** the host can set one banner image per challenge. It is
  normalised to a 1200×630 WebP (cropped to cover, metadata stripped) and stored in
  the host's DB (`challenge_banner`, one row per challenge, apart from `challenges` so
  listing never loads image bytes; deleted with the challenge). It becomes the
  background of the challenge's Open Graph card (text drawn over a darkening overlay,
  in place of the themed gradient) and the hero at the top of the public challenge
  page. Removing it brings back the themed card.

## URLs & storage

- A challenge lives at `<public-base>/u/<username>/<slug>` — the **same namespace**
  as shared dashboards. The public resolver `/public/:username/:slug` returns a
  `type` (`dashboard` | `challenge`); slugs are unique across both per user.
- The banner is served at `<public-base>/u/<username>/<slug>/banner.webp` for public
  **and** unlisted challenges (anyone with the link sees the page that shows it); 404
  when there is none. `banner_url` carries a `?v=<updated-at>` version, and a request
  whose `v` matches the stored banner's is cached `immutable` for a year (a missing or
  stale `v`: 5 minutes).
- Challenges + members live in the **host's** per-user DB; a joiner's
  _participations_ live in the **joiner's** DB, each backed by an unguessable
  `data_token`. No central-DB tables.

## Federation protocol

Aurboda serves two shapes side by side. The current one is the HTTP half of the
[QuantPub Challenges](../fep/quantpub-challenges.md) draft, advertised by
`"challenges": true` in `/.well-known/quantpub`; its documents are lowerCamelCase, as
QuantPub's are. The legacy one is Aurboda's own vendor protocol, served for instances
that predate the QuantPub shape. A joining instance prefers the QuantPub shape and falls
back to the legacy one, and a host reads a member's data in either shape.

QuantPub Challenges endpoints (under each instance's API base; discovery at the web base):

| Endpoint                                            | Auth               | Purpose                                                                                     |
| --------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------- |
| `GET /.well-known/quantpub`                         | none               | Discovery: `{ product, version, quantpub, apiBase, challenges: true }`                      |
| `GET /public/:username/challenges`                  | none               | `{ kind: "challengeList", items }`: public challenges, without `joinToken` and `members`    |
| `GET /public/:username/challenges/:slug`            | none (slug-gated)  | `kind: "challenge"` document, incl. `joinToken` and the member list (`no-store`)            |
| `POST /public/:username/challenges/:slug/members`   | none (`joinToken`) | HTTP join: `{ joinToken, name, url, actor?, entryUrl, currentEntryUrl? }`                   |
| `DELETE /public/:username/challenges/:slug/members` | none (entry URL)   | Leave: `{ entryUrl }` removes the member that registered it                                 |
| `GET /public/:username/challenges/:slug/standings`  | none (slug-gated)  | `kind: "standings"`; cached a minute for a public challenge, `no-store` for an unlisted one |
| `GET /public/:username/challenge-entries/:token`    | none (token)       | A member instance serves its `kind: "challengeEntry"` for one challenge (`no-store`)        |

The challenge's metric is a QuantPub key: a built-in metric with a RECOMMENDED key
([FEP-302f §2.1](../fep/quantpub.md)) is published under it in its canonical unit
(`steps` → `1`, `distance` → `m`, `sleep_score` → `sleepScore`, `1`); any other metric
is `aurboda:<metric>`, an activity type `aurboda:activityDuration`, and a measure
`aurboda:<measure>` (`aurboda:totalReps`), each in the spec's own unit. `scoring` is the
spec's `aggregation`, `bucket` the resolved chart size (`1w` as `7d`, `1M` as `30d`). The
document also carries `aurboda.spec`, the exact spec, so an Aurboda joiner scores the
challenge the same way; other implementations ignore it.

Legacy endpoints (served for instances that predate the QuantPub shape):

| Endpoint                                | Auth              | Purpose                                                                                  |
| --------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| `GET /.well-known/aurboda`              | none              | Discovery: `{ product, version, federation, api_base }`                                  |
| `GET /public/:username/:slug`           | none              | Resolve a slug → dashboard or challenge spec (incl. `join_token`, public member list)    |
| `POST /public/:username/:slug/members`  | none              | Register-back: a joining instance adds itself as a remote member                         |
| `GET /public/:username/:slug/standings` | none (slug-gated) | Host-aggregated standings (`?refresh=1` busts the cache)                                 |
| `GET /challenge-data/:username/:token`  | none (token)      | A member instance serves its own series for one challenge                                |
| `GET /public/:username/dashboards`      | none              | Public profile listing: public dashboards + public challenges (name, link, window, spec) |

**Join (canonical: "join by challenge URL on your own instance B", host = A):**

1. B reads `<A-base>/.well-known/quantpub`. With `"challenges": true` A is a QuantPub
   Challenges host and `apiBase` is its API; otherwise (no document, no flag) B reads
   `<A-base>/.well-known/aurboda` and takes the legacy path below. A transient failure
   (no answer, a 5xx, a 429) fails the join rather than falling back.
2. B fetches `<A-api>/public/<user>/challenges/<slug>` and takes the spec from its
   `aurboda.spec`, or, from another implementation, builds one from a bare RECOMMENDED
   metric key (`steps` summed, say). A key B cannot score (an unknown extension key)
   refuses the join: _"This instance cannot score …"_.
3. B records a local participation (spec snapshot + random `data_token`), making
   `GET <B-api>/public/<user>/challenge-entries/<token>` live.
4. B joins with `POST <A-api>/public/<user>/challenges/<slug>/members`: `url` (its
   profile, the identity), `name`, `actor` (its ActivityPub actor), `entryUrl` and the
   `joinToken`.
5. A validates the token, refuses a closed or full challenge, probes the entry, and
   stores the member with its `actor`. The entry echoes `metric` and `scoring`, and for
   a measure challenge an `aurboda` block (`measure`, `aggregation`, `filterField`,
   `filterValue`); A requires both to match its spec and otherwise refuses with `409`,
   so B rolls its participation back.

On the legacy path B fetches the spec from `<A-api>/public/<user>/<slug>`, serves
`GET <B-api>/challenge-data/<user>/<token>`, and registers back to
`<A-api>/public/<user>/<slug>/members` with `identity_base_url`, `display_name`,
`data_endpoint_url` and `join_token`; the data endpoint echoes `aggregation`, and
`measure`, `filter_field`, `filter_value` when the spec has them, and A refuses a
mismatch with `409` _"Your instance does not support this challenge's measure (…);
update Aurboda to join"_.

**Leave:** leaving a challenge on a QuantPub host also sends
`DELETE <A-api>/public/<user>/challenges/<slug>/members` with the entry URL, best
effort: a host that is down or speaks only the legacy protocol is logged and the leave
goes ahead. Either way the participation is deleted, so its entry 404s. A
participation joined over the legacy protocol sends nothing. Leaving a challenge hosted
on the same instance removes you from the host's standings directly. The tombstone
keeps the left participation's data token, so a rejoin after a leave the host never
heard presents the old entry URL as `currentEntryUrl` and reclaims the registration
instead of being refused as a second one.

An instance must know a challenge's measure to join it. One that predates measures
drops the unknown `measure` field from the spec and would score plain duration under
the challenge's name; it does not echo the measure, so step 5 refuses it. One that
knows measures but not this one refuses at step 2, with the same message.

The same-server "Join" button and the challenge page's "enter your host" prompt both
funnel into this. When B === A, steps 1–5 collapse to a direct local membership.

**Standings:** the host pulls each remote member's entry or data endpoint (5-minute TTL
cache, persisted per member; a failed fetch falls back to last-known data flagged
`stale`) and computes local members in-process. An entry's samples are read back as
buckets at `startTime + offset`, its values converted back to Aurboda's stored unit.

Each standing carries a **`last_updated`** — when that member's _contributing_ data
last changed. For a metric it is the newest `updated_at` among the contributing points
(the moment a point's value last changed; daily aggregates such as steps keep one row
per day at local midnight and are rewritten in place all day, so their `time` would
always read 00:00), falling back to the point's `time` for rows stored before
`updated_at` existed. For an activity type it is `MAX(start_time)` of the matching
activities. The same source filter bounds it as bounds the total. A point stamped
exactly at `end_ts` is outside the window, so the daily aggregate for the day after the
last day (stored at that local midnight) never counts toward the total or `last_updated`.
A member with no data yet reports `null` (rendered as "—"), never the request time — so
members on 0 don't all share a bogus "just now". Remote members report their own
`last_updated`; the host persists it (distinct from `last_fetched_at`, which is when the
host fetched) and surfaces it in standings.

**Discovery — open challenges from people you follow:** `GET /challenges/discover`
(MCP `discover_challenges`) walks the user's accepted ActivityPub followees. A followee
whose actor id has the `<base>/users/<name>` shape is a _candidate_ Aurboda peer
(Mastodon mints the same shape); the well-known documents decide (`/.well-known/quantpub`
with `challenges: true`, else `/.well-known/aurboda`), remembered per
instance for an hour so a Mastodon followee costs one probe, not one per page load (and
one probe per instance even on a cold round: concurrent followees share the in-flight
one). Only a _definite_ answer is remembered — a 404 for the well-known document, a body
that isn't Aurboda's, a refused private address. Anything that says nothing about the
host (no answer at all, a 5xx, a 429 or 403, a DNS failure or a timeout) is transient:
it is not cached, the peer is retried next round, and it is counted instead in
`peers_unreachable`. Within the round it is remembered, though: once a probe or listing
of an instance has failed transiently, its other followees are skipped rather than each
asking it again.

A QuantPub peer's public challenges are read from its `GET …/public/<name>/challenges`
listing (an item this instance could not score is left out), a legacy Aurboda peer's
from its public-profile listing (a followee on the same instance in-process); ended ones, anything the user hosts, joined or left,
and any link that doesn't point into the host's own `/u/<name>/` space are dropped.
Leaving a challenge hard-deletes the participation row, so the "don't offer this again"
fact is kept as a tombstone in `challenge_left`, keyed by the canonical challenge URL
(query string and fragment dropped, trailing slashes trimmed, scheme and host
lowercased — the same spelling a joined participation is stored under, so the same
challenge pasted two ways is one challenge). Joining again clears the tombstone. The
result is ongoing first (soonest to end), then upcoming, plus `peers_unreachable` — how
many followed _instances_ didn't answer this round (three followees on one dead host
count once). Unlisted challenges are not discoverable, by design; a peer from before the
listing carried windows lists name + link only and is skipped rather than shown as
"ongoing".

## Join from your own app

Any app can join a challenge hosted on an Aurboda instance; it does not need to run
Aurboda or ActivityPub. It takes one public JSON URL and one `POST`, in the shape of the
[QuantPub Challenges](../fep/quantpub-challenges.md) draft (§4.2 and §5). The host pulls
your numbers from that URL; you never push.

The examples use a challenge at `https://aurboda.net/u/fiddur/november-steps`. Replace
the host, user and slug with the ones in the link you were given.

**1. Find the API and read the challenge.**

```sh
curl https://aurboda.net/.well-known/quantpub
# {"product":"aurboda","quantpub":"0.2","challenges":true,"apiBase":"https://aurboda.net/api",...}

curl https://aurboda.net/api/public/fiddur/challenges/november-steps
```

The second answer is the `kind: "challenge"` document: `startTime` and `endTime` (the
window, end exclusive), `timezone` (the host's; days are counted in it), `metric`
(`steps`), `scoring` (`sum`), `unit` (`1`), `bucket` and `joinToken`.

This recipe is written for metric challenges such as steps, whose `metric` is a bare
QuantPub key. A challenge with an `aurboda:` key (an activity type, a measure such as
`aurboda:totalReps`, a metric without a QuantPub key) is scored the way its `aurboda.spec`
says, and a measure challenge also needs your entry to carry
`"aurboda": { "measure", "aggregation", "filterField", "filterValue" }` copied from that
spec; without it the join is refused with a `409`.

**2. Publish your entry at a public URL.** Any URL that answers `GET` with JSON works,
including a static file regenerated by a nightly job. The minimum is your total for the
window so far, echoing the challenge's `metric` and `scoring`:

```json
{
  "kind": "challengeEntry",
  "challenge": "https://aurboda.net/u/fiddur/november-steps",
  "metric": "steps",
  "scoring": "sum",
  "total": 123456
}
```

For a line on the race chart, add a `series` with one sample per day:

```json
{
  "kind": "challengeEntry",
  "challenge": "https://aurboda.net/u/fiddur/november-steps",
  "metric": "steps",
  "scoring": "sum",
  "total": 123456,
  "lastUpdated": "2026-11-03T21:40:00+01:00",
  "series": {
    "metric": "steps",
    "unit": "1",
    "bucket": "1d",
    "samples": [
      { "offset": 0, "sum": 8412, "count": 1 },
      { "offset": 86400, "sum": 11230, "count": 1 }
    ]
  }
}
```

- `offset` is seconds from the challenge's `startTime` to the start of the sample's day
  in the challenge's `timezone`: the local midnight, so a 23- or 25-hour day moves the
  next offset by 23 or 25 hours, not 24.
- `total` is what ranks you. Without it the host scores your samples by `scoring`: their
  `sum`s added for `sum` and `count`, the best `max` for `max`.
- `lastUpdated` is when your data last changed; the leaderboard shows it. Leave it out or
  `null` rather than sending the current time.
- Daily samples match the chart of a challenge between two weeks and four months long,
  such as a month; the document's `bucket` says which width the host draws. Other widths
  still score correctly; only your line looks different.

**3. Join.**

```sh
curl -X POST https://aurboda.net/api/public/fiddur/challenges/november-steps/members \
  -H 'Content-Type: application/json' \
  -d '{
    "joinToken": "<joinToken from step 1>",
    "name": "you",
    "url": "https://you.example/",
    "actor": null,
    "entryUrl": "https://you.example/steps/9f2c41d7.json"
  }'
```

The host fetches `entryUrl` right away and accepts you only if it answers with an entry
for the same `metric` and `scoring`. `{"status": "member"}` means you are on the
leaderboard, shown as `name · <host of url>`. `url` is your identity: to change your
`name` or `entryUrl` later, post again with the same `url` and your current entry URL as
`currentEntryUrl`. `actor` is your ActivityPub actor, if you have one.

| Status | Meaning                                                                                                                                         |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 200    | `{ "status": "member" }`                                                                                                                        |
| 400    | A malformed body, or your URL did not answer with a `challengeEntry`                                                                            |
| 403    | Wrong `joinToken`                                                                                                                               |
| 404    | No such challenge                                                                                                                               |
| 409    | The challenge has ended or is full (200 members), your entry scores another metric, or `url` is a local member or registered with another entry |

**Rules for the entry URL.**

- It must be `http` or `https` on a public address: localhost and private networks are
  refused, redirects are not followed, the answer must come within 8 seconds and be
  under 1 MB.
- Make it unguessable. Only the host learns it, it never appears in any public
  response, and it is both what guards your numbers and what proves you are you when
  you change or leave, so put a random token in the path.
- The host reads it at most every 5 minutes, when someone opens the standings, and once
  more when the winner is announced, 6 hours after the window closes. Have your last day
  published by then.

**Leaving.**

```sh
curl -X DELETE https://aurboda.net/api/public/fiddur/challenges/november-steps/members \
  -H 'Content-Type: application/json' \
  -d '{ "entryUrl": "https://you.example/steps/9f2c41d7.json" }'
```

`{"status": "left"}` removes you from the standings; `404` means no member registered
that entry URL. Make the URL answer `404` too.

**Standings.** `GET https://aurboda.net/api/public/fiddur/challenges/november-steps/standings`
answers `kind: "standings"`: every member's `rank` (equal totals share one), `total`,
`lastUpdated`, `stale` and `samples`.

**Trust.** Numbers are self-reported, as for every member (see _Security & trust_). This
is meant for friendly competitions.

**Not supported yet.** The ActivityPub half of the draft (the challenge as an `Event`,
`Join` / `Leave` in the inbox), `joinMode: restricted`, pushed entries and teams. An
Aurboda instance joins another app's challenge only when its `metric` is a bare QuantPub
key Aurboda has as a metric (`steps`, `distance`, `sleepScore`). The winner announcement
tags winners as ActivityPub mentions by mapping `<base>/u/<name>` to
`<base>/users/<name>`, so a winner whose app has no actor there is named in the post but
not notified.

The older Aurboda-only shape (`/.well-known/aurboda`, `POST /public/<user>/<slug>/members`
with a `{ total, buckets }` data URL) still works; see the legacy table above.

## Completion & winner announcement

When a challenge's window closes, the **host's instance** announces the result: a
`challenge` post on the host's feed (see [feed.md](feed.md#feed-posts)) carrying the
frozen **final standings** — the podium (everyone ranked 1–3; competition ranking, so
equal totals share a rank and a tie for first means several winners) plus the member
count — with each **winner tagged** as an ActivityPub `Mention` (and addressed in
`cc`, delivered to their inbox), so the winner's own instance notifies them even when
they don't follow the host (a post mentioning you is one you're _involved_ in, see
[feed.md](feed.md#home-timeline-inbound)). A `public` challenge announces publicly; an
`unlisted` challenge is link-only by the host's choice, and even an `unlisted` post is
world-readable and would publish the slug (which hands out the join token + member
list), so its result goes to **followers only** — the tagged winners still get it in
their inbox. Only members who scored make the podium; a challenge nobody scored in
announces nothing.

- **Host setting:** `announce_winner` on the challenge (default **true**). In the web
  app: the "Announce the winner to my feed when it ends" checkbox when creating, and an
  "Announce winner" toggle on each hosted row while `announcement_pending` is true —
  the announcement has not been made or skipped (`result_published_at` unset) and the
  challenge has not ended, or ended within the 3-day announce window; older ones are
  never visited by the sweep, so the toggle disappears rather than promising nothing
  (#1078). Over the API the field is on `POST`/`PUT /challenges` and the
  `create_challenge` / `update_challenge` MCP tools.
- **Timing:** a scheduled sweep (pg-boss cron, every 10 minutes, over every user's
  hosted challenges) announces a challenge once it has been over for a **6-hour grace
  period**, so members' last-day data has had time to sync before the podium is
  frozen. Standings are re-fetched (remote members included) at that moment. A
  **stale** member — their instance couldn't be reached, so the host only has
  last-known (or zero) data — holds the announcement back to the next sweep rather
  than freezing a podium on cached totals; once the challenge has been over for
  **24 hours** (`STALE_ACCEPT_AFTER_MS`) last-known data is accepted so an instance
  that is gone for good can't block the result forever.
- **Once only, never retroactively:** `result_published_at` on the challenge is stamped
  when the announcement is made (or deliberately skipped), so a challenge never
  announces twice. Only challenges that ended within the last **3 days** are ever announced
  (`MAX_ANNOUNCE_AGE_MS`) — the column backfills `announce_winner = true` onto
  pre-existing challenges, and without that bound the first sweep after deploy would
  fan out every challenge that ever finished (federated deliveries can't be recalled).
  A sweep also publishes at most **20** posts (`MAX_ANNOUNCEMENTS_PER_SWEEP`); the rest
  wait for the next tick. Switching `announce_winner` off before the sweep runs
  suppresses the post; switching it back on later (still inside the window) re-arms it.
  `result_published_at` and the derived `announcement_pending` are exposed on the
  hosted `Challenge`.
- **Result payload** (`ChallengeResult` on the post's `challenge.result`): a snapshot
  of names, identities, ranks and totals as of the announcement. A winner's identity
  (`<base>/u/<user>`) maps to their actor id (`<base>/users/<user>`) for the `Mention`,
  and to their `@user@host` handle for its name; the federated HTML links the winner
  Mastodon-style (`h-card` / `u-url mention`).

The public challenge page medals the podium as soon as the window has closed (🏆/🥈/🥉
in the rank column), and the Android widget shows a result banner (see below). Both are
**provisional until the announcement**: the host's post freezes the podium only after
the grace period (up to 24 h with a stale member), and a member's last-day data syncing
in the meantime can still reorder the page (#1076). The page says so rather than
calling the standings final.

## Security & trust

- The unguessable slug + capability tokens are the gates; data endpoints are
  **host-only secrets** (never in any public response).
- `join_token` proves a joiner actually fetched the spec; the host probes the data
  endpoint before accepting and can remove members. Leaving deletes the participation
  so the endpoint 404s.
- On the QuantPub path a member's `url` is its identity and its registered entry URL the
  proof: a `joinToken` holder can join, but changing or removing a member takes that
  member's current entry URL.
- **Trust model:** a member's instance is trusted to report honest numbers
  (Strava-style). A malicious self-hoster could serve fabricated values — accepted
  for now; instance-key signed requests are a future hardening.

## Deployment note

`GET /.well-known/quantpub` and `GET /.well-known/aurboda` must be reachable at the
**web base URL** an operator gives out (e.g. `https://aurboda.net/.well-known/quantpub`). Route `/.well-known/*`
to the backend in the reverse proxy (standard for federation). Dev instances that hit
the backend directly need no extra config.

## Using it in the web app

- **Manage** at `/challenges` ("Challenges" under the sidebar **Sharing** section): create a challenge (name,
  metric or activity type, sum/count — or for a type with list items a measure, an
  exercise and sum/max — unit, date range with This-week/This-month quick-sets,
  public/unlisted), copy its link, delete it, and **Set / Replace / Remove
  banner** (PNG, JPEG, WebP or GIF up to 10 MB; a thumbnail shows on the row once one
  is set); see challenges you've
  joined; and **join by URL** (paste any challenge link — local or remote).
- **From people you follow:** open challenges hosted by followed users (any Aurboda
  instance) that you haven't joined, each with a one-click **Join** — see _Discovery_
  above. The section is hidden while there is nothing to show; a note says when a
  followed instance couldn't be reached.
- **View** at `/u/<username>/<slug>`: a cumulative **race chart** (one line per
  member) + a **leaderboard** (rank, colour dot matching the member's chart line,
  `@member · host`, total, freshness), under the host's banner when one is set. This is
  the same `/u/:username/:slug` page as shared dashboards — the server returns a
  `type` and the page renders the right view.
- **Join buttons:** logged-in users on the host instance get a one-click **Join**;
  anyone can **Join from another instance** (enter your Aurboda host → you're sent
  to your own instance's `/challenges/join`, which does the federated join).
- **Join page** `/challenges/join?challenge=<url>`: joins on load (the user already
  clicked Join on the host's page), then redirects to the challenge. With `&confirm=1`
  (the Android widget's suggestion, where nothing was clicked yet) it first shows the
  challenge — name, host, what it counts and its window, read with
  `GET /challenges/preview` — and joins only on its **Join** button, then stays on your
  instance (the challenge's page when hosted here, else `/challenges`): the app's WebView
  would hand another instance's page to the browser, where you are not logged in. Logged
  out, it links to login and comes back to the same page, `confirm` included.
- **Share to feed** (#994): every row on `/challenges` — hosted **and** joined — has a
  **Share to feed** button that publishes an invitation to the federated feed: an
  optional personal note (markdown, previewed in the dialog) plus the challenge's
  canonical link, with the usual `public`/`unlisted`/`followers` audience. The server
  resolves the linked name/URL from the challenge (or the joined participation) itself,
  and never embeds a join token. Federates as a `Note`; Mastodon shows
  the link with the challenge page's OG preview card; an Aurboda peer fetches the post's
  structured payload (the challenge document plus a standings snapshot) and renders the
  race chart and leaderboard natively on its timeline. **Attach standings chart image**
  (on by default, `include_chart`) also attaches the race as a PNG rendered from the
  standings at fetch time, for Mastodon and other apps that cannot draw it (see
  [feed.md](feed.md#images)). Also available as the `share_challenge` MCP tool /
  `POST /feed/challenges`. See [feed.md](feed.md#feed-posts) for the post model.

## Android widget

The Android app has a home-screen **Challenge widget** (2×2 and up): pick a
hosted or joined challenge when placing it and it shows the race chart and
leaderboard (same member colours as the web page), refreshed after each sync;
tapping it opens the challenge in the app. Standings are read from the hosting
instance's public standings endpoint, so it works for challenges hosted elsewhere
too. Once the challenge has ended the widget shows the **final standings**: a
banner with a big 🏆 "You won!" when you won (🥈 / 🥉 "You came 2nd/3rd" with the
winner named when you made the podium; otherwise who won and where you finished),
and medals in the leaderboard's rank column.

Reconfiguring a widget is awkward on some launchers, so a day after its challenge
ends the widget **moves on by itself**: to the running challenge of yours that ends
soonest, else the upcoming one that starts soonest (a challenge that vanished from
your lists — left, or deleted by its host — is replaced right away). With nothing
of your own open it **suggests** the first discovered challenge (see _Discovery_)
— "Join a challenge?" with its name, host and window; a tap opens your own
instance's join page with `confirm=1`, which shows the challenge with a Join
button. Without a suggestion the finished challenge's result stays up.
See `docs/android-app.md` → _Home-screen widgets_.

## API surface (authed, owner/joiner)

`/challenges` — `GET` (list hosted), `POST` (create), `GET/PUT/DELETE /:id`,
`GET /:id/standings`, `GET /:id/members`, `DELETE /:id/members/:memberId`,
`GET /challenges/participations/mine`, `GET /challenges/discover`,
`GET /challenges/preview?challenge_url=<url>`, `POST /challenges/join`,
`DELETE /challenges/participations/:id`. The same CRUD + join is available over MCP
(`create/list/update/delete_challenge`, `join_challenge`, `discover_challenges`,
`preview_challenge`). A preview reads the challenge the way a join would — in-process for
this instance, else from the host's QuantPub document or Aurboda public resolver — and
answers its name, host (`host_identity`, `host_handle`), window, timezone and spec without
joining; it fails with the join's statuses (400 not a challenge link, 404 no such challenge
here, 502 host unreadable or not scorable here). A hosted challenge carries
`announce_winner` (create/update/read; see _Completion & winner announcement_). An update
that changes the spec of a challenge with a remote member is refused (`409` over REST; see
_Spec frozen once a remote member joins_ under _Model_).

Banner: `POST /challenges/:id/banner` (multipart, field `banner`; 400 for a missing,
unsupported or undecodable file, 404 for a challenge that isn't yours) and
`DELETE /challenges/:id/banner` both answer with the `Challenge`; the removal is also
the MCP tool `remove_challenge_banner`. `banner_url` (absolute, versioned; `null` when
none) is on `Challenge` (REST and the MCP `list/update_challenge` output) and on the
public `PublicChallenge`. There is no MCP tool for the upload itself: a binary upload
has no MCP counterpart, as with the profile avatar.

## Out of scope (v1) / future hardening

- Background polling, goals/consistency/teams.
- **Signed instance-to-instance requests** (instance keypairs) — would bind a
  registering member's identity to the instance that vouches for it, closing the
  register-back gaps below.
- Register-back is capped per challenge (`MAX_CHALLENGE_MEMBERS`) to bound growth,
  but on the legacy path a slug+`join_token` holder can still re-register an existing
  _remote_ member (overwriting its data-endpoint URL). The QuantPub join closes this
  (`currentEntryUrl`); the legacy route stays as it is for older instances.
- Standings has no in-flight de-duplication, so concurrent requests on a cold/expired
  cache each fan out to every remote member (thundering herd, bounded by the TTL +
  8s per-fetch timeout). A shared in-flight promise per challenge would remove it.
