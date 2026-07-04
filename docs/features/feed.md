# Federated Activity Feed

The activity feed lets a user publish an **activity** (a run, a night's sleep, a
meditation, …) to their public feed, choosing **per post exactly which data leaves the
instance**, and have it delivered over **ActivityPub** to followers on Mastodon and the
wider fediverse. It reuses the same base-URL identity and `/u/<username>` namespace as
[shared dashboards](./sharing.md) and [challenges](./challenges.md).

The feed is built on [Fedify](https://fedify.dev). It has three layers:

1. **Persistence + metric selection** — what a post is and what it exposes.
2. **Public series endpoint** — the unauthenticated, data-driven privacy boundary for
   high-resolution series.
3. **ActivityPub federation** — a per-user actor, WebFinger discovery, follower
   inbox/outbox, and delivery of the post's lifecycle (create / update / delete).

## Feed posts

A **feed post** references one of the user's activities and records the explicit metric
selection that bounds what is shared:

- **`included_metrics`** — the scalar summaries the user opted to share (e.g.
  `duration`, `distance`, `heart_rate_avg`, `heart_rate_max`, `hr_zone_minutes`,
  `calories`, `stress_avg`). This is the single source of truth for the human-readable
  summary and the machine-readable scalars a remote Aurboda instance reads.
- **`series_metrics`** — a **separate, explicit opt-in** for high-resolution continuous
  series (e.g. per-5-second heart rate or stress). A per-sample trace is far more
  revealing than an average, so series are **off unless deliberately chosen**, even for
  a metric whose scalar summary is shared.
- **`visibility`** — `public`, `unlisted`, or `followers`.
- **`include_chart` / `include_map`** — attach a rendered heart-rate chart and/or
  GPS route-map image to the post (see [Images](#images)).

Defaults are privacy-conservative: sharing an activity with no explicit selection
shares no scalars and, crucially, **no series**.

## ActivityPub federation

Each user is a single ActivityPub **actor** (a `Person`) at:

```
<public-base>/users/<username>          e.g. https://aurboda.net/users/fiddur
```

The `/users/` prefix is dedicated to federation and never collides with the human-facing
`/u/<username>` profile/dashboard pages. The actor publishes an RSA public key (used to
verify HTTP Signatures) held in the per-user `feed_actor` table.

**Discovery (WebFinger).** The actor is resolvable by handle:

```
acct:<username>@<host>                  e.g. @fiddur@aurboda.net
```

so anyone on Mastodon (or any fediverse server) can search for `@fiddur@aurboda.net`,
open the profile, and **Follow**. A `Follow` arrives at the actor's inbox; Aurboda
verifies its HTTP Signature, records the follower (`feed_follower`), and replies with an
`Accept` so the remote server marks the relationship established. `Undo{Follow}` removes
the follower.

Canonical absolute URLs (actor id, inbox/outbox, object ids, WebFinger self-link) are
always built from the configured public base (`WEB_HOST`) as **https**, so they stay
correct behind the TLS-terminating proxy (which forwards over loopback http).

### Publishing & lifecycle delivery

Sharing, editing, or unsharing a post federates the matching activity to the user's
followers (best-effort, fire-and-forget; delivery is synchronous — a durable retry queue
is a later slice):

| Action  | Federated activity  | Effect on followers                       |
| ------- | ------------------- | ----------------------------------------- |
| Share   | `Create{Note}`      | The post appears in their timeline        |
| Edit    | `Update{Note}`      | Their stored copy is replaced             |
| Unshare | `Delete{Tombstone}` | The post is retracted from their timeline |

The `Note` is Mastodon-compatible: an HTML `content` summary flattening the title and the
shared scalar summaries, plus a `name` headline, addressed per the post's visibility
(`public` → AS2 Public + followers; `unlisted` → followers + Public in `cc`; `followers`
→ followers only). The custom structured `aurboda:` extension (typed metrics + series
links) is a separate, richer representation for Aurboda-to-Aurboda consumers.

**Merged activities.** A post stores only `activity_id` (the plain anchor uuid). When that
activity is part of a **merge group** (overlapping cross-source records, shown in the
detail view as `merged:<anchor>`), the delivered/served/listed scalars and the rendered
chart/route images are resolved over the **full merged span** — the same window the detail
view and share dialog present — not the anchor sub-activity's narrower slice. The window is
resolved at query time (via the same `resolveActivityWindow` the `merged:` detail view
uses), so nothing denormalised is persisted on the post.

### Outbox & object serving

- **Outbox** (`/users/<username>/outbox`) — a **cursor-paginated** `OrderedCollection`
  of the user's `public` + `unlisted` posts as `Create` activities, newest-first, so the
  actor's profile shows their posts. The root returns `totalItems` + `first`/`last` page
  links; each page (`?cursor=<offset>`) serves up to a fixed page size with a `next` link.
  `followers`-only posts are never listed.
- **Object** (`/users/<username>/feed/<postId>`) — the post's `Note`, served at its
  canonical id so a remote server can dereference it. Only `public`/`unlisted` resolve;
  `followers`-only and unknown ids return 404. Once a `public`/`unlisted` post is
  **deleted**, that id returns **`410 Gone` with an AS2 `Tombstone`** (recorded in
  `feed_tombstone`) so a dereferencing server learns the object is *permanently* gone
  rather than transiently missing. A `followers`-only id is never tombstoned — it never
  resolved publicly, so a 410 would leak that a post once existed.

The `Note` carries `published` = the post's share time (its `created_at`), so remote
servers order and timestamp it correctly instead of stamping it at receipt.

The object we deliver, list in the outbox, and serve at that id are all built from one
place, so they can't drift.

### Following other actors (inbound)

The feed also runs the **inbound** direction: a user can follow other fediverse actors
(remote *or* another local Aurboda user). Following `@alice@mastodon.social`:

1. resolves the target actor (WebFinger + actor fetch) to its inbox + presentation,
2. records a **pending** follow in `feed_following`, then
3. sends a signed `Follow` from the user's actor to the followee's inbox.

Following **yourself** is rejected (it would deliver a `Follow` to your own inbox and echo your
posts into your timeline). Resolving the actor's avatar is bounded by a short timeout, so a slow
icon host can't hang the (synchronous) follow. When a follow fails, the web panel surfaces the
server's specific reason (e.g. an unresolvable handle) rather than a generic message.

When the followee's server answers with an `Accept`, the inbox marks the follow
**accepted**; a `Reject` drops it. Unfollowing sends an `Undo{Follow}` to the cached inbox
and removes the row. Local follows use the exact same path (delivered to the local inbox
over loopback), so there is no special-casing. Delivery is best-effort/synchronous, matching
the rest of the feed — a failed `Follow` POST leaves the pending row so the user can retry.

The actor advertises a **following collection** (`/users/<username>/following`) listing only
*accepted* follows (a pending follow isn't a confirmed relationship yet). The followee's
inbox URIs are internal delivery details and are never exposed on the owner-facing API.

### Home timeline (inbound)

Posts from followed actors arrive at the user's inbox and are stored as a **home timeline**.
When a `Create` or `Update` for a `Note` is delivered, the inbox:

1. confirms the sender is an **accepted** followee (`feed_following`) — activities from
   anyone else are ignored, so an unsolicited `Create` can't inject into the timeline,
2. **sanitises** the note's HTML content server-side (`sanitize-html`, a strict tag/attribute
   allowlist) — remote content is untrusted, so this is the XSS boundary, then
3. upserts a `timeline_entry` (keyed by the note's `object_uri`, so an `Update` or a
   redelivery replaces in place rather than duplicating).

A `Delete` removes the matching entry; unfollowing removes all of that actor's entries. The
timeline is read back **newest-first**, keyset-paginated on `(published_at, id)` behind an
opaque `next_cursor` — the same cursor style as the outbox — via `GET /feed/timeline` and the
`list_timeline` MCP tool. Because the content was sanitised on ingest, the web client renders
it directly.

Two ingest guards keep the timeline honest given `object_uri` is a **globally-unique** upsert
key: the note's id must be on the **sender's host** and, when it declares `attributedTo`, must
attribute to the sender (so an accepted followee can't overwrite another actor's post by
colliding its id); and `published_at` is **clamped to "not in the future"** on ingest (it's the
sort key, so a far-future timestamp would otherwise pin a post to the top).

### Live updates

New posts appear **without a refresh**. When a genuinely new `timeline_entry` is inserted, the
ingest path emits a Postgres `NOTIFY` ping on the user's DB (each user has one long-lived
connection, so the ping is received in-process). The web client holds an **SSE** stream open at
`GET /feed/timeline/stream`; each ping is forwarded as an empty `event: new` (no post content on
the wire — just "your timeline changed"). The client then refetches the newest page and shows a
**"N new posts"** pill; clicking it prepends the new posts.

The stream uses `fetch` (not `EventSource`) so the bearer token rides in the `Authorization`
header rather than the URL, and sends `X-Accel-Buffering: no` so nginx flushes each event
immediately. If the stream can't be opened or drops, the client **falls back to polling** the
same newest page every 30s — so the pill still works without a live connection. In-process
fan-out is handled by a single `TimelineHub` that keeps one `LISTEN` channel open per user
regardless of how many tabs are streaming.

### Images

A post can carry a rendered **heart-rate chart** (`include_chart`) and/or a **GPS
route map** (`include_map`) as AS2 `Image` attachments, so Mastodon shows them inline.
Both are rendered on demand (SVG → PNG) from the activity's data at public,
unauthenticated endpoints:

```
GET /api/public/:username/feed/:postId/chart.png
GET /api/public/:username/feed/:postId/route.png
```

An image is served when the matching flag was opted into. `public`/`unlisted` posts
serve their images unauthenticated. A `followers`-only post's image URLs instead carry
the post's **unguessable capability token** (`?token=<image_token>`), which is embedded
only in the `Note` delivered to followers; a request without a matching token 404s. This
is a deliberate capability-URL model (like the shared-dashboard slugs), chosen because
the fediverse fetches media **without** HTTP signatures — Mastodon's "authorized fetch"
signs ActivityPub object/actor requests, not media downloads — so a signed-request gate
wouldn't be exercised and followers would just see a broken image. The tradeoff is that a
leaked image URL grants access to that one rendered image (a chart or a route map,
not the underlying high-resolution series, which stays `followers`-excluded entirely).
Responses are `no-store`, so an unshare / cleared flag / a public→followers flip takes
effect immediately (the now-untoken'd public URL 404s). The route is drawn over an
**OpenStreetMap street basemap** (see below); **no privacy trimming** is applied (area
masking is a planned follow-up), so a route map reveals the precise area. The share dialog
only offers the chart toggle when the activity has heart-rate data and the map toggle when
it has an actual GPS track.

**Route basemap.** The route map projects the GPS track into Web Mercator, fetches the
covering OpenStreetMap tiles, and composites them behind the track (with a white halo for
legibility) plus start/end markers. The required "© OpenStreetMap contributors"
attribution is baked into the image. OSM's tile usage policy is respected: a descriptive
`User-Agent`, and low volume — route renders are cached per post, so tiles are fetched at
most once per route until eviction. Tile fetching is best-effort with a short timeout; if
the tiles can't be fetched (e.g. offline) it falls back to a bare polyline on a dark
background.

## Public series endpoint (the privacy boundary)

High-resolution series are **never** embedded in a post. Instead each shared series is
exposed through a public, read-only endpoint:

```
GET /public/:username/series?metric=<key>&start=<iso>&end=<iso>&bucket=<5s|60s|…>
```

Like a shared-dashboard slug, it takes **no auth token** — so the scoping below is the
_entire_ privacy boundary, and it is **data-driven, not obscurity-based**. A request
resolves only when **all** of these hold:

1. some feed post shared **that exact metric as a series** (`series_metrics`) — sharing
   only the scalar summary never exposes the series;
2. that post is **`public` or `unlisted`** (a `followers`-only post has no public series);
3. the shared activity is **not soft-deleted** and has a bounded window (an `end_time`);
4. the activity's window **covers** the requested `[start, end]` range.

When it resolves, the effective range is **clamped** to the activity's window (the
caller's bounds can never widen it), the bucket granularity is **floored** server-side
(minimum 5s) to bound payloads, and only the requested metric's aggregated buckets are
returned — per-measurement timestamps are dropped. Anything else — an unshared metric,
a `followers`-only share, a window outside any shared activity — returns **404**.

Deleting a feed post, changing its visibility to `followers`, removing the metric from
`series_metrics`, or soft-deleting the activity all immediately stop the series from
resolving.

## Using it in the web app

- **Share** — an activity's detail page has a **Share to feed** button. It opens a dialog
  to pick the summary metrics, optionally opt into full series, and choose the audience.
- **Manage** — the **Feed** page (`/feed`, the 📣 item in the sidebar) lists everything
  you've shared, with each post's audience and metrics. From there you can **Edit** a
  post (re-opens the dialog; saving federates an `Update`) or **Unshare** it (federates a
  `Delete`).
- **Follow** — the Feed page's **Following** panel lets you follow a fediverse actor by
  handle (`@user@host`) and see who you follow, with a **Pending** badge until the remote
  server accepts and an **Unfollow** button.
- **Home timeline** — below the Following panel, the Feed page shows your **Home timeline**:
  posts from the actors you follow, newest-first, as native cards with a **Load more** button
  to page further back. New posts arrive **live** (or via polling fallback) as a **"N new
  posts"** pill at the top; click it to reveal them.

## API

Owner-facing (authenticated, scoped to the caller):

| Method & path                     | Purpose                                            |
| --------------------------------- | -------------------------------------------------- |
| `GET /feed`                       | List my feed posts (each enriched with the shared activity's title/type and merged-span window, resolved at query time) |
| `POST /feed/activities/:id/share` | Publish an activity with a chosen metric selection |
| `PATCH /feed/:postId`             | Edit selection / visibility / attachments          |
| `DELETE /feed/:postId`            | Unpublish (its public series stops resolving)      |
| `GET /feed/following`             | List the actors I follow (accepted + pending)      |
| `POST /feed/following`            | Follow an actor by handle (`@user@host` or actor URL) |
| `DELETE /feed/following/:id`      | Unfollow (sends `Undo{Follow}`)                    |
| `GET /feed/timeline`              | My home timeline (posts from followees), newest-first, `?cursor=` to page |
| `GET /feed/timeline/stream`       | Server-Sent Events stream of live "new posts" pings (falls back to polling) |

Public / federation (unauthenticated):

| Method & path                                  | Purpose                                                     |
| ---------------------------------------------- | ----------------------------------------------------------- |
| `GET /public/:username/series`                 | Bucketed samples for a **shared** series within its window  |
| `GET /public/:username/feed/:postId/chart.png` | Rendered HR chart for an opted-in post (`?token=` for followers-only) |
| `GET /public/:username/feed/:postId/route.png` | Rendered GPS route map for an opted-in post (`?token=` for followers-only) |
| `GET /.well-known/webfinger`                   | Resolve `acct:<username>@<host>` → the actor                |
| `GET /users/:username`                         | The actor document (`Person`)                               |
| `GET /users/:username/outbox`                  | Public + unlisted posts as `Create` activities              |
| `GET /users/:username/followers`               | The actor's followers collection                            |
| `GET /users/:username/following`               | The actor's following collection (accepted follows only)    |
| `GET /users/:username/feed/:postId`            | A single post's `Note` (or `410` Tombstone once deleted)    |
| `POST /users/:username/inbox` (+ `/inbox`)     | Inbound `Follow` / `Undo{Follow}` / `Accept` / `Reject` (HTTP-Signature verified) |

The owner-facing capability is also available over MCP as `list_feed`, `share_activity`,
`update_feed_post`, `delete_feed_post`, `list_following`, `follow_actor`, `unfollow_actor`,
and `list_timeline` — all backed by the same services as the REST routes.

## Storage

Feed posts live in the user's own database in the `feed_posts` table. `activity_id` is a
**soft reference** (no foreign key): activities are soft-deleted and the series lookup
re-checks `deleted_at` at query time, so a removed activity simply stops resolving rather
than cascading a delete. A GIN index over `series_metrics` backs the public series
endpoint's authorization check. Each post also holds an unguessable `image_token`
(defaulted at insert) that gates its `followers`-only image URLs. Deleting a
`public`/`unlisted` post hard-deletes its row
and, in the same statement, records its id in `feed_tombstone` so the object id can still
answer `410 Gone`. Followers live in `feed_follower`; the actors this user **follows** live
in `feed_following` (keyed by a local `id`, with the followee's cached inbox + handle /
display name / avatar and an `accepted` flag); the actor's RSA keypair in `feed_actor`.
Posts received from followees are stored in `timeline_entry` (keyed by the remote note's
`object_uri` so an `Update`/redelivery replaces in place), holding the **already-sanitised**
content plus the author's cached handle / display name / avatar, indexed on
`(published_at DESC, id DESC)` for the keyset-paginated home timeline.

## Caveats & limitations

These are known and intentional for the current implementation:

- **Visibility downgrade doesn't retract from non-followers.** Narrowing a `public`
  post to `followers` federates an `Update` addressed only to followers; servers that
  showed it to non-followers keep their copy. This is an inherent ActivityPub limitation
  (Mastodon behaves the same) — there is no addressable "public" inbox to retract from.
- **The public series endpoint uses the anchor window for merged shares.** The delivered
  Note's scalar summary and the rendered images cover the full merged span, but
  `GET /public/:username/series` still authorizes only the shared activity's *own* window
  (`findCoveringSharedSeriesWindow` joins on `activity_id`). Since the delivered
  Mastodon `Note` carries no series links, this is latent — expanding series
  authorization across a merge group (which needs the merge algorithm at query time) is a
  planned follow-up.
- **Route maps have no privacy trimming.** The route is drawn over an OpenStreetMap
  basemap and shows the full track, so a public route map reveals the precise area
  (including start/end points, i.e. likely home/work); start-point and area masking are
  planned follow-ups. Only share a route publicly when that exposure is acceptable.

## Related

- [Sharing & public pages](./sharing.md) — the shared-dashboard foundation and the
  base-URL identity model this reuses.
- [Challenges](./challenges.md) — cross-instance federated competitions on the same
  `/u/:username` namespace.
