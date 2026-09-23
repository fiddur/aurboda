# Tryout recipes

Everything tryouts of this app have had to learn the hard way: routes, selectors, fixtures,
oracles and traps, grouped by area. Read the section for the area the PR touches before writing a
script. Each entry keeps the `(#PR)` it came from, so the run that learned it can be found.

These were learned against a compose stack on one machine, with an MCP connection to the app and
a `gh` on the path. The rig is the same shape — same image, same Postgres — but the mechanics
differ; [`AGENTS.md`](./AGENTS.md) has the translation table. Where a translation has not been
exercised since, the entry says `(untested here)`.

[← back to the tryout brief](./AGENTS.md)

## Shorthands used below

```sh
BASE=http://127.0.0.1:${TRYOUT_PORT:-8080}
TOKEN=$(cat "$TRYOUT_DIR/token.txt")
dc() { docker compose -p aurboda-tryout-cloud "$@"; }
psql() { dc exec -T postgres psql -U aurboda_service -d "$1" -Atc "$2"; }
```

Addressing the project by name rather than by `-f tryouts/docker-compose.yml` means the commands
work from any directory and need none of the environment the compose file interpolates.

`dc exec aurboda …` runs inside the app container, which holds the backend **TypeScript source**
at `/app/apps/backend/src` (Node runs it directly through type stripping) and the built web
bundle under `/usr/share/nginx/html`. `dc logs aurboda` is the app log. The demo user is
`qsreddit_demo` unless `DEMO_USER` said otherwise, and its database is `aurboda_qsreddit_demo`.

---

## Feed and federation

### The wire has three separate channels — check each (#1034)

A feed post reaches a peer by three paths that do **not** share a serialization:

1. **Dereferenceable object**: `curl -H 'Accept: application/activity+json' "$BASE/users/<user>/feed/<postId>"`.
   Followers-only posts correctly 404 here.
2. **Outbox listing**: `GET /users/<user>/outbox` returns only `totalItems` + `first`/`last`
   (cursor-paginated since #908/#890, `OUTBOX_PAGE_SIZE=20`); fetch `?cursor=0` for the
   `OrderedCollectionPage` of `Create`s and follow `next`. Out-of-range/negative/non-numeric
   cursor → 404; an in-range offset past the end → 200 empty page.
3. **The delivered `Create`/`Update`/`Delete`**: only observable at a real follower inbox.

Channels 1 and 2 serialize the instance directly. Channel 3 does not: `Context.sendActivity` runs
Fedify's default activity transformers, and `actorDehydrator` does
`activity.clone({ actors: activity.actorIds })` unconditionally — the clone has a pristine
`toJsonLd`, so **an instance `toJsonLd` patch never survives `ctx.sendActivity` in fedify ≥ 2.x**.
That is how the `quant:Exercise` extension went missing on delivery while both read paths kept it
(→ #1040). The airtight probe beats arguing from the captured body: build the activity with the
real helper in an in-container probe, then apply `create.clone({ actors: create.actorIds })`
yourself and diff `toJsonLd()` before and after.

### Capturing a delivered activity (#854, #864, #928, #967, #1027, #1107)

`sendActivity` is a plain fetch with **no** private-address guard (unlike the document loader), so
a listener on the host works. Run a node server on the host and address it from the container as
`http://host.docker.internal:<port>/inbox`, then seed a follower row:

```sh
psql aurboda_qsreddit_demo "insert into feed_follower (actor_uri, inbox_uri, accepted)
  values ('https://mastodon.example/users/x', 'http://host.docker.internal:9099/inbox', true)"
```

One listener captures **both legs** of a fan-out if you give them different paths: the followers
fan-out lands on `/inbox` while a mentioned or answered author's inbox is `/bob/inbox`, and one
`captures.jsonl` tells them apart by path (#1107). **Delete the seeded rows afterwards** — every
later share retries a dead inbox otherwise, and a throwing leg can abort the rest of the fan-out
(#1079).

What has been captured this way:

- **Create/Update/Delete on a feed post** (#864, #869): `Update{Note}` id is
  `<noteId>#update-<updated_at epoch ms>`, unique per edit, wrapping the Note at the _same_
  canonical object id; `Delete{Tombstone}` id is `<noteId>#delete`. REST `PATCH`/`DELETE
/api/feed/:id` and the MCP twins all fan out identically (#869 closed the #865 gap where only
  REST delivered).
- **Visibility addressing**: public → `to: as:Public, cc: followers`; unlisted →
  `to: followers, cc: as:Public`; followers-only → `to: followers`, never Public, on Create,
  Update and Delete alike.
- **Accept/Reject on follower approval** (#928): `Accept` wraps the reconstructed
  `Follow{actor=follower, object=our actor, id=<the original follow_activity_uri, echoed>}`; the
  `id` is omitted when the stored `follow_activity_uri` was null.
- **Follow / Undo{Follow}** (#917): `id=<origin>/users/<user>/follows/<rowid>`, and the Undo is
  the same id with `#undo`.
- **Update{Person}** on avatar change (#1053): signed `sig1=:…:` plus an LD `signature`,
  `to: …#Public`, `cc: …/followers`, id `…#updates/<Date.now()>`.
- **Like / Announce** (#1104): `Like` lands at the author's inbox alone with no `to`/`cc`;
  `Announce` at the follower _and_ the author inbox; the undo is `…/likes/<uuid>#undo` wrapping
  the exact activity. Reacting to a **boost card** targets `boost_of_uri` and resolves the
  original author's inbox by lookup.

Signatures cover `@target-uri`/`@authority`, so a captured body **cannot be replayed** to another
host (#1027).

Delivery is **synchronous**: #866 dropped the `queue` option because nothing called
`federation.startQueue()`, so an enqueued Create was never drained. Confirm the image still has
the fix with `dc exec aurboda grep -r InProcessMessageQueue /app/apps/backend/src/services/activitypub/`
— empty output is correct. Delivery lands ~60 ms after the HTTP response returns.

### Delivering a signed activity **to** the inbox (#919, #1064, #1104, #1107)

The long-standing "inbound signed Follow always 401s" wall (#919) **is nginx, not Fedify**: the
config uses `proxy_set_header Host $host`, and `$host` strips the port, so the app hashes
`host: localhost` while the sender signed `host: localhost:8080`. Production (`:443`, no port in
Host) is unaffected.

The recipe that works: **sign and send `Host: localhost:8080`, but connect to the backend
directly at `127.0.0.1:3000`, from inside the container.**

```sh
dc cp send.mjs aurboda:/tmp/send.mjs && dc exec aurboda node /tmp/send.mjs
```

Use node's `http.request` with an explicit `host` header — undici's `fetch` drops it. The app pins
`createFederation({origin})` and `@fedify/express` builds the Request URL from `req.protocol` +
`req.host`, so signing `localhost:3000` 401s too. Success is **202 "Activity is enqueued."**;
unsigned is `401 "Failed to verify the request signature."`. The two failure modes are
distinguishable in the log: `Failed to fetch key` is the SSRF guard refusing the keyId,
`Failed to verify the request's HTTP Signatures` is a real mismatch.

Draft-cavage form that verified:
`Signature: keyId="<actorurl>#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest content-type",signature=…`
with `Digest: SHA-256=<b64(sha256(body))>`.

**The sender actor must be genuinely public.** `createFeedFederation` does not set
`allowPrivateAddress`, so Fedify's default loader refuses loopback and private keyIds — and
`ipaddr.js` calls TEST-NET-3 (`203.0.113.0/24`) reserved too, so even a fake-peer subnet is
refused for _lookups_ while still working for _delivery_. The old rig hosted the actor document
on a gist (bare `gist.githubusercontent.com/<user>/<id>/raw/<file>` serves 200 `text/plain` with
no redirect, which Fedify and `safeFetchGet` both accept). **There is no gist tool in the cloud**
— if a check needs a public-https AS2 document, say it could not be driven rather than
improvising (`AGENTS.md` → _What this rig cannot do_).

Gist traps worth keeping for whoever finds a replacement host: raw URLs are **cached hard** after
the first fetch, so a self-referential id cannot be fixed by editing the same filename — write
new filenames (`v2-*`). The `id` must be its own **non-versioned** raw URL or Fedify's
id-vs-fetch-URL consistency check rejects it. `noteToTimelineInput` requires
`note.id.host === new URL(actor_uri).host`, so actor and notes must share a host.

### Getting Fedify to explain itself (#1104)

The app configures no LogTape sink, so Fedify's debug and error logs are discarded and `dc logs`
is silent about signature failures. `dc cp` a `_debug-log.ts` that `await import`s
`/app/node_modules/.pnpm/@logtape+logtape@<version>/…/dist/mod.js` and configures category
`fedify` at `debug`, then `sed -i "1i import './_debug-log.ts'"` on `api.ts` and restart. Keep a
`.bak` and restore it. The same import path works from a standalone `src/_probe.ts`.

### In-container probes: running the real code without the HTTP trigger

The single most valuable technique in this file. The container runs the backend **source**, so a
probe dropped beside it imports the real modules and talks to the real database:

```sh
dc cp probe.ts aurboda:/app/apps/backend/src/_probe.ts
dc exec -w /app/apps/backend aurboda node src/_probe.ts
```

It must live under `/app/apps/backend/src/` — anywhere else and `node_modules` resolution fails
with `Cannot find package '@fedify/fedify'`. Two ways to get a database handle: import
`_setClientForUser` from `./db/connection.ts` and hand it `new Client({ database: 'aurboda_<user>' })`
(the service `PGUSER`/`PGPASSWORD` are already in the container env), or just call `query(user, …)`
and let it connect lazily.

What has been driven this way:

- **The on-follow timeline backfill** (#933): `createTimelineBackfiller(createFeedFederation(WEB_HOST, apiBaseUrl), WEB_HOST)`
  then call the returned fn `(user, actorUri)` — exactly `api.ts`'s wiring — and sleep ~10 s.
  Success prints the real `📥 Backfilled N post(s) from <actor> into <user>'s timeline`. Only the
  HTTP `Accept` trigger is swapped for a direct call.
- **`ingestNoteForRecipient`** (#1061, #1110): the shared core behind both inbox delivery and the
  backfill. `new Note({ replyTarget: new URL(...) })` proves `inReplyTo` is captured; `published`
  wants a `@js-temporal/polyfill` Instant. For the inbox branches that need an actor serving
  _nothing_ (unreadable actor → no signature verification → no signed delivery possible), the
  image ships `apps/backend/src/test/inbox-context.ts`: `createFeedFederation('http://localhost:8080', …)`
  so `parseUri` resolves own-post URIs, then `handleInboundFollow` / `handleInboundCreate` with
  `inboxContext(fed, ORIGIN, '<user>', docs)`.
- **Delivery to a _local_ actor** (#1087): `ctx.lookupObject` is a plain HTTP fetch with
  `allowPrivateAddress: false`, so a `localhost` mention resolves to null and the app logs
  `⚠️ … delivery to @x@localhost:8080 skipped: actor not resolvable`. Wrap `createContext` so
  `ctx.lookupObject(id, { documentLoader: getDocumentLoader({ allowPrivateAddress: true }), … })`
  and the real `deliverFeedDelete(deps, user, post)` then reaches the local winner's inbox.
- **`processGarminData`, `processActivityDetail`, `syncGravlWorkouts`** — see _Sync and
  integrations_.

### Nothing listens on the app's own origin from inside the container (#1087)

`WEB_HOST` is `http://localhost:<TRYOUT_PORT>`, but inside the container the app is on `:3000` and
nginx on `:80` — so every URL the app builds for itself ECONNREFUSEDs from inside. Run a sink
there: `dc cp sink.mjs aurboda:/tmp/ && dc exec -d aurboda node /tmp/sink.mjs`, listening on
`0.0.0.0:8080`, **capturing POSTs and proxying GETs to `127.0.0.1:3000`** (rewriting the Host
header). Self-addressed follower rows then receive signed activities instead of failing, and local
actor documents resolve. `pkill -f sink` afterwards.

### Reading a post without the delivery dance (#877, #908)

`GET /users/<user>/feed/<postId>` with `Accept: application/activity+json` serves the Note for
public/unlisted posts only (followers-only → 404: delivered inline, never dereferenced). Content
is **rendered at fetch time** from current code (`buildFeedNote` → `feedPostContent`), so posts
shared before the deploy show the new formatting. The served Note carries no `aurboda:` extension
— Fedify's typed vocab drops it; that representation lives only in `object.ts` and unit tests.

To control duration output: the `duration` scalar is `round((end-start)/1000)` s over the
**referenced activity's own window**. 642 s renders `10m 42s`, 3720 s renders `1h 2m`; the
headline is `<p><strong>title</strong></p>` with stats on their own `<p>`. **Gotcha**: for a post
referencing a _merged_ activity's anchor uuid, that window is the anchor sub-activity's, not the
merged span the detail view shows, so merged shares under-report (#881).

### Feed post kinds, shapes and guards

- `/api/feed` (bearer) returns `{posts:[…]}`, **not** a bare array, and each post carries a
  `content` field = the exact federated AS2 HTML (#884 slice 1).
- **Activity share**: `POST /api/feed/activities/:id/share` — **not** `/api/activities/:id/share`,
  which 404s (#1052). Body `{visibility, series_metrics, include_chart, include_map}`.
- **Article**: `POST/PATCH /api/feed/articles`, blocks
  `[{type:'prose'|'chart'|'correlation', …}]` (#947, #948, #967).
- **Challenge**: `POST /api/feed/challenges` with **exactly one** of `challenge_id` /
  `participation_id` (#1027). Both or neither → 400 "Provide exactly one…", unknown id → 404,
  unauthenticated → 401, `participation_id: null` → a zod 400 rather than the exactly-one message.
- **Anti-spoof probe** (#1027, the central claim of that PR): post the body with extra
  client-supplied fields — `"challenge":{"name":"SPOOFED","url":"https://evil.example/phish"}`
  and `"kind":"activity"` — alongside a real `challenge_id`. Zod strips them and the stored
  payload is the server-resolved `{name, url}` matching the challenge's own `share_url`. A
  `participation_id` resolves `{name, challenge_url, host_identity}` and carries **no**
  `data_token`: the capability token stays in `challenge_participations.data_token`.
- **Reply**: `.feed-post-action--reply`; body-supplied `in_reply_to_*` are stripped; a
  `followers`-visibility reply 404s at its object id and is absent from the outbox; a **public**
  reply is still excluded from `/api/public/:user/posts` (kind, not visibility) (#1107).
- **Loop closer** (#1027): the URL in a challenge post really is a join target —
  `POST /api/challenges/join` with `challenge.url` creates an active participation.

### Followers, following and approval (#917, #922, #928)

- Following: `GET /api/feed/following`, `POST /api/feed/following {handle}` (`@user@host`,
  `user@host` or an actor URL), `DELETE /api/feed/following/:id`. Mounted **before** `/feed` so
  two-segment paths do not hit `/:postId`.
- Followers: `GET /api/feed/followers?status=pending|accepted|all`,
  `POST /api/feed/followers/:id/approve`, `DELETE /api/feed/followers/:id` (404
  `{error:"No such follower"}` on an unknown id).
- Serialized `FollowingActor`/`FollowerActor` = `{accepted, actor_uri, avatar_url, created_at,
display_name, handle, id}` and **never** leak `inbox_uri`/`shared_inbox_uri`/
  `follow_activity_uri`, though those are cached in the DB for addressing.
- The `following` and `followers` collections are **accepted-only** (pending excluded from
  `totalItems` and `orderedItems`). Flip `feed_following.accepted` in psql to watch `totalItems`
  move.
- `manually_approve_followers` (bool, default false) turns the account locked; the actor document
  then advertises `manuallyApprovesFollowers: true`. It is a **user setting**:
  `GET`/`PATCH /api/user/settings`. There is no `PUT /api/settings` (that 404s "Cannot PUT").
- Switching the setting off does **not** retroactively accept pending rows.
- **Self-follow guard** (#922) returns 422 `{error:"You can't follow yourself."}` but cannot be
  reached here: the check runs after `lookupObject`, the loopback URL is SSRF-blocked, and a
  hosted document merely _claiming_ the local id fails Fedify's id-vs-fetch-URL check (404
  "Could not resolve"). Correct by construction; do not file it.
- **Unfollow purges the timeline** and _is_ drivable: seed a `feed_following` row (accepted, any
  dead `inbox_uri` such as `http://192.0.2.1/inbox`) plus some `timeline_entry` rows for that
  actor, then unfollow — only that actor's entries go, and the Undo delivery failure is swallowed
  so the purge still runs (#920).
- UI: `.following-panel` > `.following-title`, `.following-form` > `.following-input` + submit,
  `.following-list` > `.following-row` (`.following-avatar`, `.following-name`,
  `.following-handle`, `.following-pending`, `.following-unfollow`), empty state
  `.following-empty`. Errors surface the **server's** message in `.following-error` (#922). The
  followers panel adds `.followers-subtitle` "Follow requests" + `.followers-count` badge above
  pending `.following-row`s with Approve/Reject, accepted rows below with Remove; approving moves
  the row live and decrements the badge (#928).

### The home timeline (#920, #921, #926, #929, #1061)

Table `timeline_entry` in the per-user DB: `id` uuid PK, `object_uri` TEXT **UNIQUE** (the upsert
key), `actor_uri`, `handle`/`display_name`/`avatar_url`, `content` (already-sanitised HTML),
`url`, `published_at`, `received_at`, plus later additions `structured` JSONB, `images` JSONB,
`in_reply_to_uri`, `reply_checked_at`, `mentions_me`, `boost_of_uri`,
`boosted_by_handle`/`boosted_by_display_name`; index `(published_at DESC, id DESC)`.

**Seeding it directly is the read-path workhorse.** `INSERT … SELECT … FROM generate_series(1,25)`
with spaced `published_at` exercises the whole REST + web surface without any federation.

- `GET /api/feed/timeline?limit=&cursor=` → `{entries, next_cursor, success}`, keyset-paginated
  newest-first, `limit` 1–50 default 20 (out of range → 400). The DTO has no `received_at` before
  #1061 and does from #1061 on.
- `next_cursor` base64url-decodes to `<published_at_ms>:<uuid>`. A malformed cursor **and** a
  crafted `12345:not-a-uuid` both fall back to page one (the `UUID_RE` guard), rather than a
  `$::uuid` 500. Equal `published_at` rows page with no duplicate or skip.
- Serializer omits the `images` key when it is null **or** an empty array (#929).
- Render rule: `entry.structured ? <TimelineStructured> : entry.images?.map(<img class="feed-post-image">)`
  — native chart if the data was shared, else the delivered image.
- Structured charts: `.timeline-structured` > `.timeline-chart` figures with
  `.timeline-chart-label` + `<svg>`; a `TrendLineChart` per series with ≥ 2 samples (#926).
- **The client sanitises nothing.** Seeding raw `<img src=x onerror=…>` into `content` executes
  it in-page, so ingest-time `sanitizeRemoteHtml` is the sole XSS boundary (#920).
- **Replies are filtered in SQL, not post-hoc** (#1061). The oracle: interleave 4
  replies-to-strangers _above_ 3 top-level posts by `published_at` and request `limit=3` — a
  full page of 3 proves SQL-side filtering, where a post-hoc filter would have returned an empty
  first page. A reply-to-me needs a real own-post id: `select id from feed_posts …` → target
  `http://localhost:8080/users/<user>/feed/<id>` (that is what `ownObjectPrefix` builds from
  `WEB_HOST`).
- The home timeline hides replies unless `timeline_show_replies` is on — flip it through
  `PATCH /api/user/settings` and restore it (#1107).

### Live updates: the SSE pill (#921)

`emitTimelineNotify` is `SELECT pg_notify('timeline_updates','')` on the user's database and
`openTimelineChannel` does `LISTEN timeline_updates` on the same per-user connection, refcounted
across tabs by `services/timeline-hub.ts`.

`GET /api/feed/timeline/stream` is authenticated SSE: 200 + `text/event-stream` +
`Cache-Control: no-cache, no-transform`, `: connected` immediately, `: ping` every 25 s, and
`event: new\ndata: {}` per notify (no post content on the wire). 401 without auth. `X-Accel-Buffering: no`
**is** set by the app but nginx consumes it, so it is absent from the client-facing response —
expected, not a bug.

**The trick**: `LISTEN/NOTIFY` is database-wide, so you do not need the ingest path at all —

```sh
psql aurboda_qsreddit_demo "NOTIFY timeline_updates"
```

and the open SSE stream receives it identically. Insert a newer row, notify, and the browser shows
`.timeline-new-pill` "1 new post"; clicking prepends and scrolls to top. `upsertTimelineEntry`
returns `inserted` via `(xmax = 0)` in `RETURNING`, so an edit or redelivery does **not** ping;
verify that with the same `INSERT … ON CONFLICT … RETURNING` twice (t then f).

A hidden reply must **not** raise the pill: the client refetches through the same filtered API, so
inserting a reply row plus a notify gives no phantom pill while a visible insert gives "1 new
post" (#1061).

### Enrichment: local-origin resolution and lazy retro-enrichment (#926, #1015)

On inbound Create/Update whose Note id matches `/users/{user}/feed/{uuid}` (`FEED_OBJECT_PATH` —
Mastodon `/statuses/` never matches), the app discovers the peer via `/.well-known/aurboda`
(`api_base` + `federation: true`) and fetches `{api_base}/public/{user}/feed/{postId}` through
SSRF-guarded `safeFetchGet`.

**The A/B that proves "in-process, not HTTP"** (#1015): `safe-fetch` blocks 127.0.0.1, so calling
`enrichFromAurboda(uri, {discover, fetchStructured})` _without_ the `local` dep throws
`Refusing to fetch a private/loopback/reserved address (127.0.0.1)` while
`createAurbodaEnricher(WEB_HOST)(uri)` returns the payload. One probe is the whole pre-fix/post-fix
story for a same-instance share.

**Retro-enrichment fixture matrix**: `timeline_entry.object_uri` is unique, so every fixture needs
its own post. Seed rows with `structured = NULL, enrich_attempted_at = NULL` and distinct
`published_at` (the batch is 3, newest first): local public → enriches; local followers-only with
`?token=` in `images` → enriches (token lift); local nonexistent post or wrong token → "no
payload" log; remote `peer.example` → `ENOTFOUND` log; `…/users/x/feed/<non-uuid>` → stamped
silently. `GET /api/feed/timeline` triggers the pass; the read returns in ~5 ms and the database
fills a few seconds later.

**What it uncovered (#1018)**: `noteToTimelineInput`'s attribution check only runs
`if (attributions.length > 0)`, so a Note with **no** `attributedTo` and an id belonging to a
different user on the sender's host is accepted — any accepted local followee could overwrite
another's entry. The A/B is the same Create shape with `attributedTo` removed (dropped after the
fix) against a with-attribution control (ingests).

### Reply expansion, mentions and stranger involvement (#1064, #1065, #1066, #1107)

- **Involvement matrix through the real inbox** (all answer 202; only two rows land): admitted =
  a reply to my own _existing_ `feed_posts` id, and a `Mention` of
  `http://localhost:8080/users/<me>`. Dropped = a plain stranger post, a reply to a _missing_ own
  post, a Mention with no `attributedTo`, a Mention whose `attributedTo` is a different actor on
  the same host, a Mention of another local user, a reply to another local user's post. The author
  snapshot on admitted rows is the signature-verified sender.
- **Lazy reply/mention backfill**: seed `timeline_entry` rows with `reply_checked_at = NULL` and
  `received_at = now()` (batch 3, newest first) pointing at AS2 objects — one with `inReplyTo`
  (learns the link, disappears from the filtered page on the next read), one with a `Mention` tag
  (`mentions_me` → t, stays), one unfetchable `*.invalid` row already carrying `in_reply_to_uri`
  (only stamped — the never-clobber path). One `GET /api/feed/timeline` fires the pass.
- **Expand replies** fixtures: a note whose `replies` is an inline Collection with a `first` page,
  mixed inline and URI items and a `next` page proves the walk; a byline-forged item
  (`attributedTo` on another host) is dropped; `url:"javascript:alert(1)"` → null;
  `published:"not-a-date"` → null; `<script>`/`onerror` stripped (`window.PWNED` stays undefined).
  **25 inline replies from one author → exactly 20, `partial: true`, all 20 authors named** — the
  memoisation oracle, since 20 unmemoised lookups would blow the 15-fetch budget. Blackholed items
  (`https://203.0.113.1/…`, not SSRF-blocked) → the route returns in ~12 s with `partial: true`.
  Nothing is persisted.
- `fetched` fixtures: a note **declaring no collection** answers `fetched: true, replies: []`
  (declaring none counts as read); a 401 from the origin answers `fetched: false` and the web says
  "Couldn't read the thread from <host>." — an unsigned GET, so authorized-fetch instances always
  read as empty (#1065).
- `mergeOwnReplies`' dedupe branch is **not drivable here**: the origin's snapshot would have to
  carry our own `object_uri` (`<origin>/users/<u>/feed/<postId>` — note `feed/`, not `posts/`),
  which means an item whose id host is `localhost:8080`; a URI item is fetched through
  `safeFetchGet` (refused) and an inline one fails the authority-host check. Only the _append_
  branch is observable live (#1107).
- `listTimelineRepliesTo` is `ORDER BY published_at ASC … LIMIT 100`, so a post with more than 100
  comments silently loses the **newest** ones while the uncapped `reply_count` chip still
  advertises them (#1109).

### Like, boost and reactions (#1104, #1110)

- Routes: `POST`/`DELETE /api/feed/timeline/<id>/like` and `…/boost`.
- **Forgery oracles**: an inline forged `actor` on a `Like` (`preferredUsername: FORGED`) still
  stores the _fetched_ handle and display name; an `Announce` carrying an inline `Note` with
  forged content and a different `attributedTo` shows the dereferenced content and the real
  author.
- **Boost-card negatives**, all of which must leave the row count unchanged: a non-followee
  booster, a Note id on another host, a Note without `attributedTo`, an `Announce` id on a host
  other than the booster's.
- **Dedupe A/B**: seed a direct entry for the Note → no card; delete it, re-announce with a fresh
  id → card appears. The dedupe is **one-directional** — `Announce` first and the author's own
  `Create` second leaves two cards (#1106).
- `Update{Note}` refreshes a boost card only when a direct entry for that Note also exists, while
  the Announce ingest creates a card only when it does _not_ — so an ordinary "boost of someone
  you don't follow" card keeps pre-edit content forever (#1112). The followee-author control
  refreshes correctly.
- **Two-legged delivery failure**: a dead follower row fails the _followers_ leg for free; for the
  _author_ leg seed a `feed_following` row whose `inbox_uri` is a closed port on the host
  (`http://host.docker.internal:9199/dead/inbox`) plus a post by that actor — a cached inbox skips
  `resolveAuthorInbox`, which would otherwise 502 the route before delivery. The boost then logs
  both `⚠️ Announce delivery to followers failed …` and `⚠️ Announce delivery to the author failed …`.
- A 502 fixture is simply a timeline row whose `actor_uri` host ends in `.invalid`.
- **Undo pair oracle**: two reactions from the same actor, one keyed on a resolvable `Block`
  document and one on an id that 404s. `Undo` of the Block deletes nothing (it resolved, and
  Blocks are not modelled); `Undo` of the 404 id still retracts both rows via the bare-activity-id
  fallback. `Undo{Follow}` is unaffected.
- **Boost-vs-reply fixtures are pure SQL**: a plain reply row and a boost card row that share
  `in_reply_to_uri` and differ only by `boost_of_uri` — the plain one is hidden, the card is
  shown. For the comment tally, seed a boost card whose `in_reply_to_uri` is one of your own
  posts: 3 rows point at the post while `reply_count` and `/api/feed/:id/replies` both say 2.

### Inbound Update{Person}: the stale-seed inversion (#1110)

Never fight a fixture host's caching to change a served document. Seed the DB rows **stale**
(`@alice_OLD@…`, `Alice OLD Name`, an old avatar URL) and let the immutable document be the NEW
truth. One signed `Update{Person}` then refreshes all five cached copies at once —
`feed_following`, `feed_follower`, `timeline_entry.handle`/`display_name`/`avatar_url` (author)
and `boosted_by_handle`/`boosted_by_display_name` (booster), and `feed_post_reaction`. Keep a
`restale.sql` to reset between rounds. Avatar **removal** (SET, not COALESCE) needs a second actor
whose document simply has no `icon` → `avatar_url` goes NULL.

Negative control: a third actor sends `Update{Person}` whose _object_ is the first actor's id →
those rows stay stale (`isSelfActorUpdate` is ids-only). A bare-id `"object": "<actor url>"`
refreshes exactly like an embedded `Person`.

The **inbound** half of avatar federation does not exist yet: `.on(Update, …)` routes to
`ingestFeedActivity`, which drops anything that is not a `Note`, so a peer's profile Update is
ignored and `feed_following.avatar_url` is frozen at follow time (#1057).

### Articles (#947, #948, #967)

- Blocks are `{type:'correlation', trigger, outcome, lag_days?, start?, end?, caption?}`;
  `trigger`/`outcome` are `CorrelationSelector`s discriminated on `kind`
  (`metric`/`tag`/`activity`/`nutrition`/`productivity_*`). A block inherits the article's
  `default_start`/`default_end` when its own window is omitted.
- Seed data only into **already-registered** custom metrics — the bulk metric endpoint rejects
  unknown metric names ("Invalid metric") and activities reject unknown types. Register the metric
  first, or use a built-in activity type for a presence trigger.
- **Two headline paths** in `CorrelationScatterSvg`: a non-binary trigger gives `r · ρ · n · p`; a
  **binary/presence** trigger (every aligned value 0/1, e.g. an activity count) gives
  `Δ(present−absent) · d · n · p` instead of Pearson r. A metric selector's `threshold` is **not**
  binarised in the continuous series (values stay raw → `group_comparison` null), so use an
  activity or tag selector for a real 0/1 trigger. `n < 3` → "Not enough overlapping data in this
  window."; a null window → "This correlation has no time window."
- Render DOM: `svg.article-scatter` with one `circle` per aligned day, a regression `line` stroke
  `#e0457b`, `.article-scatter-annot`, two `.article-scatter-axis` labels.
- **Composer** (#948): `/feed` → **New article** → **+ Correlation**. Trigger input is
  `input[list="selector-pattern-options-activity"]` (the id is kind-suffixed), outcome metric
  input `input[list="selector-metric-options"]`, lag
  `input[placeholder="0 — days the outcome lags the trigger"]`, and the block window is the
  **3rd/4th** `input[type="datetime-local"].article-input` ([0] and [1] are the article default
  window). The client guard shows `Correlation block N: choose a trigger (metric or pattern).`
  with **no POST**; the server's window gate (a block with no own window and no article default)
  is a 400 surfaced in-dialog and is intentional, not a bug.
- **Block images** (#967): `GET /api/public/:user/feed/:postId/blocks/:index/image.{png,svg}`.
  Chart block → 1000×420 line SVG/PNG, colour `#673ab8`, metric name as title. Correlation block →
  900×600 scatter, OLS line `#f472b6`, an `r=… · ρ=… · n=… · p=…` headline,
  `describeSelectorAxis` axis labels. Both on `#0b0f19` with `Cache-Control: no-store`. The gate
  is **post visibility only** (no `include_chart` flag): public/unlisted open and a bogus `?token=`
  is ignored, `followers` needs the exact `image_token` and a near-miss 404s; flipping
  public→followers instantly revokes a warmed URL. 404 (not 403) for a prose block, an
  out-of-range index, a non-article post, a bad uuid or username, sparse data (chart < 2 points,
  correlation n < 3) and a zero-duration bucket. The index is `Number()`-normalised, so
  `2`/`02`/`2.0`/`0x2`/`" 2"` collapse to one cache entry while `-1`/`2abc` 404. **Editing busts
  the cache** (the key includes `updated_at`): narrowing a chart window 7d→2d gives different PNG
  bytes and a new `?v=`.
- **An article federates as a `Note`, not an AS2 `Article`.** The #967 body says `Article` at a
  `…/feed/<id>/article` dispatcher with `Create{Article}`; that path 404s and never shipped
  (#970). Reality: `Create{Note}`, the Note at the shared `…/feed/<postId>` object path, `name` =
  title, `content` = `<p><strong>title</strong></p>` + marked-rendered prose + caption paragraphs,
  one `Image` attachment per chart/correlation block with `?v=<updated_at ms>` (and `&token=` only
  when followers-only). Delete → `410 Gone` `Tombstone{formerType: Note}` and the images 404. The
  outbound sanitiser strips `<script>`/`<iframe>`/`onerror`/`javascript:` hrefs but keeps GFM
  tables, `hr` and `<br>`.

### The two sanitisers disagree (#1028)

Feed a note containing `<form action="…"><input name="pw"></form>`, `<div onclick style="color:red">`,
a `data:` image, an `<iframe>` and a `vbscript:` href. `renderProse` (which builds the AS2
`.content`) strips form, div, iframe, `data:` src and `vbscript:`; the web's shared
`renderMarkdown` **keeps** the form, the input, the inline `style` and the `data:` image — visible
on the unauthenticated `/u/<user>` card. It reproduces identically on an article prose block, so
it is the shared sink rather than any one PR.

### Feed cards on the web (#884 slice 1, #916, #938)

- Card root `.feed-post` (an `<article>`); the old `.feed-card` chip list is gone.
- Header `.feed-post-head` (a `<header>`) with `.feed-post-avatar`, `.feed-post-name`,
  `.feed-post-handle` (`@user@host · <relative time> · <visibility icon>`; the visibility label is
  on `span[aria-label]`).
- Body `.feed-post-content`, rendered with `dangerouslySetInnerHTML` from the API `content` field.
- Images `.feed-post-image` under `.feed-post-media`; own-post controls in `.feed-post-footer`.
- Identify a specific post's card by matching `.feed-post-media img` src against the post id.
- The top of `/feed` is the **home timeline**; own posts are under the "Your posts" heading.
- #916 (the global `header { background-color: #673ab8 }` leaking into card headers) was fixed by
  #938: assert `getComputedStyle('.feed-post-head').backgroundColor === 'rgba(0, 0, 0, 0)'`, with a
  bare injected `<header>` computing `rgb(103, 58, 184)` as the counterfactual.
- `.feed-error` has **no dark-mode variant** — a light-pink box in dark mode. Pre-existing.
- Reply/comment DOM: `.feed-post-action--reply` (🗨, `aria-expanded`), `.feed-reply-composer`
  (`.feed-reply-text`, radios defaulting to **Unlisted**, `.btn-primary` "Post reply"),
  `.feed-post-replies-toggle`, `.feed-post-reply-mine` ("YOU"), `.feed-post-reaction-chips`
  containing `🗨 n`, `.feed-post-comments` > `.feed-post-comment`, `.feed-post-reply-marker`.
- **Web rollback-per-entry oracle** (#1110): intercept `POST …/timeline/<id>/like`, sleep 5 s,
  answer 502; click ⭐ and then click `.timeline-more` while it is in flight. Correct behaviour is
  40 → 60 cards that **stay** 60 after the failure, with `aria-pressed` back to `false` and the
  server's reason in `.feed-post-action-error`. A whole-cache snapshot restore would collapse the
  list back to the click-time 40.
- Interception plus a 2 s sleep on `/api/feed/timeline/*/(like|boost)` makes the optimistic state
  observable (#1104).

### Feed post images (#884, #929)

`/api/public/<user>/feed/<postId>/{chart,route}.png` — unauthenticated for public/unlisted,
`?token=<image_token>` (**not** `?image_token=`) for followers-only. **The `/api` prefix is
required**: bare `/public/<user>/feed/…/route.png` returns the nginx SPA `index.html` with a 200
and `text/html`, which looks like a working endpoint and is not. The backend derives the same URL
as `${apiBaseUrl}/public/<user>/feed/<id>/route.png` in `deliver.ts`.

For `visibility: followers` posts the web omits the images (the browser has no token), so
`.feed-post-image` is empty; flipping visibility between `followers` and `public` and reloading
exercises both sides without seeding. Read the PNG back with the Read tool, or probe pixels.

---

## Timeline, charts and activity detail

### The `/timeline` page (#979)

- **Hash view state needs a real reload.** `/timeline` reads `#from=<ISO>&to=<ISO>&o=h|v` once, at
  module load, into module-level signals. A `page.goto()` that changes only the hash is a
  _same-document_ navigation, so the view silently keeps the previous range while `location.hash`
  shows the new one. Always `page.goto(url)` then `page.reload({ waitUntil: 'networkidle0' })`.
  Keep the ISO strings UTC-`Z` and encoded: `parseViewHash` uses `URLSearchParams`, which turns a
  literal `+02:00` into a space.
- **Picking spans by pixels**: `timeAxisPixels = .timeline-chart-container clientWidth - 120`
  (the horizontal margins); at a 1280px viewport with the sidebar that is 1016 → 896.
  `pixelsPerHour = timeAxisPixels / viewHours`, and the single-day merge gap is
  `min(10 min, 7px / pph)`. For a pair 8m51s apart: 24 h → 37 pph → gap 600 s (merged), 20 h → 45
  pph → 563 s (merged), 18 h → 50 pph → 506 s (**split**), 3 h → 299 pph → 84 s (split). Choosing
  two spans either side of the pixel threshold, both under the 10-minute cap, is what proves the
  gap tracks pixels rather than a fixed floor.
- **Reading bars**: both orientations draw clickable bars as `a[data-clickable="true"] > rect`
  with `href="/detail/activity/<id>"`, so bar count plus hrefs are the merge oracle (a merged bar
  has one href — its _first_ member). Tooltip: `page.mouse.move` to the rect centre, then read
  `.timeline-tooltip` innerText
  (`"YogaA\nSat 1 Aug · 21:11 – 22:07\n57m\nMerged: Yoga ×2"`). Real wheel zoom works:
  `page.mouse.wheel({deltaY:-120})` ×14 over a bar commits the new range through `onZoomEnd` and
  updates the hash.
- **Seeding the Screen Time lane without a sync**: adding a screentime category provisions the
  derived activity type immediately (it answers with `activity_type_name`), so an activity of that
  type with `data.category_path` gives real Screen Time bars. Those bars link to
  `/screentime-categories/<id>`, not to an activity. A fresh demo user has no screentime
  categories at all.

### Comments on the timeline (#1117)

- **Glyph oracle**: 💬 bubbles are leaf SVG elements — `.timeline-chart-container svg *` filtered
  by `children.length === 0 && textContent.trim() === '💬'`. Map a glyph to its comment by hovering
  and reading `.timeline-tooltip` innerText (the title is the first content line, "N replies" when
  threaded).
- Panel `.comment-panel`, anchor link `.comment-panel-anchor a`, synced badge `.comment-source`,
  reply box `.comment-reply-link` → `.comment-reply-form textarea`. Right-click menu
  `.timeline-context-menu`. Entity pages have `.notes-section` (heading "Comments").
- **"Hiding skips the fetch" needs a discriminating jump.** The comments range read pads the view
  by days, so "Back 1 day" often stays in the same query key and issues no request _even when
  enabled_. Use `button[title="Back 1 month"]`: enabled produces 1 `GET /api/notes?from&to`, hidden
  produces 0, re-enabling produces 1. The legend is collapsed by default — click the `Legend ▾`
  button first, then the `.legend-item` containing "Comments". Do not match buttons by `◀`, which
  is the sidebar collapse.
- **Seeding a synced comment**: insert into `notes` with `source='oura'` and the parent's times —
  that gives a badge, no Edit, and `PATCH` → 400 "came from a synced source".
- Touch long-press works headless: CDP `Emulation.setTouchEmulationEnabled` +
  `Input.dispatchTouchEvent` touchStart, wait 900 ms.
- Report pages live at `/reports/:id`; `/detail/:type/:id` does **not** handle `report`.

### Activity detail and the share dialog (#886, #931, #1024, #1058)

- Route `/detail/activity/<uuid>` (from `/detail/:type/:id`).
- `ActivityChart`'s toggle legend is `button.chart-toggle` (gaining `.active`); the Share dialog
  opens from a `button` reading **"Share to feed"** — _not_ the sidebar "🔆Share" link, which
  routes to `/shared-dashboards` — and renders `.share-dialog` with `fieldset.share-dialog-group`
  (legends "Summary metrics", "Share full time-series", "Images") each holding
  `label.share-dialog-checkbox` > `input[type=checkbox]`; the fusion note is `p.share-dialog-note`.
- **`ActivityChart` EXCLUDED_METRICS** drops `calories_active`, `calories_total`, `distance`,
  `steps`, `intensity_minutes`, `floors_climbed`, `hr_zone_*_sec`, `training_impulse` and
  `activity_impulse`. So even when an activity **has** that data it is not charted and therefore
  not mirrored into the dialog. Metrics that do chart and mirror: `heart_rate`, `speed`, `power`,
  `elevation`, `run_cadence`, `stress_level`. For a clean multi-metric chart, seed an activity
  with `heart_rate` + `speed` over its window.
- `defaultsFromChart` pre-checks the cumulative staples Distance and Calories even though the
  chart legend has no such toggles (#1024) — seed `distance`/`calories_active` points **inside**
  the activity window and they appear ON; a heart-rate-only activity gets no such checkbox at all.
  What the fix does **not** cover (#1026): the availability gate and the backend's
  `resolveSharedScalars` both read the **time-series**, while the detail page prints
  Distance/Calories from `activity.data.*` — Garmin and Strava imports set only `data.distance`/
  `data.calories`, so those activities show "Distance 8.20 km" on the page and no Distance
  checkbox in the dialog.
- The **Images** fieldset only renders when there is a real GPS track, so a no-GPS activity shows
  no Images section (#931).
- #931 fused the HR chart image into the HR series toggle: `include_chart = canChart && series.has('heart_rate')`.
  REST and MCP fields stay **independent** — only the dialog fuses them, which you can prove by
  seeding a legacy image-only post through REST (`{include_chart:true, series_metrics:[]}`) and
  opening Edit: the Heart-rate series box is checked (folded), and saving untouched backfills
  `series_metrics:['heart_rate']`.
- The VisibilitySelector radios have **no `value` attribute** (all read `"on"`) — click the
  `label.visibility-option` whose text matches, then assert against the intercepted POST body.
- `.share-dialog` **element** screenshots stitch scrolled content, so a below-the-fold Leaflet map
  can appear to overlay the dialog — take a viewport screenshot before believing a z-index bug.
- Mobile 390px: no overflow; the dialog is `max-height: 90vh; overflow-y: auto`.

### Chart geometry (#1058)

`CombinedMetricChart` is used by `/feed`, `/u/:username` and `/detail/activity/:id`.

- `.chart-svg-container` clientWidth is the container. The bottom x-axis
  `g[transform="translate(0,y>0)"] > path.domain` `getBBox().width` is `innerWidth`, so
  `container - 50 - plotWidth` is the right margin actually used: **14 / 65 / 110** for 0 / 1 / 2
  right axes.
- Right axes are root-`g` children with `translate(x>0,0)`; the left axis is the transform-less
  `g` with a `path.domain`.
- Clipping check: max `getBoundingClientRect().right` over `text,path,rect,line` minus the svg's
  right edge — negative means nothing is painted past the edge.
- To force the **2 right axes** allocation on a 3-metric detail page (heart_rate/power/speed),
  click the toggles `Power, Speed, Power, Speed`: that pushes heart_rate out of the axis-holding
  pair so the first series claims the left slot while drawing no axis. It also happens naturally
  on 3-series feed cards.
- Residual: d3 exceeds the `.ticks(3)` hint, so a narrow multi-axis card still overlaps its
  `HH:mm` labels at 280px CSS width (#1059).
- A transient `<rect> attribute width: A negative value is not valid` console error when the
  container measures 0 during an SPA route change is pre-existing.

---

## Challenges

### Endpoints

- Hosted: `GET /api/challenges`, `POST /api/challenges`, update is **PUT** `/api/challenges/:id`
  (not PATCH), `DELETE /api/challenges/:id`.
- Joined: `GET /api/challenges/participations/mine` — **not** `/api/challenges/participations`,
  which hits the `/:id` route and fails on a uuid parse.
- Join `POST /api/challenges/join {challenge_url}`, leave
  `DELETE /api/challenges/participations/:id`.
- Public view `GET /api/public/<user>/<slug>` → `{type:"challenge", visibility, …}`; standings
  `GET /api/public/<user>/<slug>/standings`.
- Discovery `GET /api/challenges/discover` (#1091).
- Remote-reported values: self-join your own `share_url`, read
  `challenge_participations.data_token`, then `GET /api/challenge-data/<user>/<token>`
  (unauthenticated) (#1089).

### Seeding fixtures

- **Own-challenge self-join works** and is the cheapest way to get a "Joined"-badged row beside a
  "Hosted by you" one; the same challenge then legitimately appears twice in a group. Deleting the
  hosted challenge does **not** cascade the participation — leave it explicitly (#1068).
- **Time statuses**: `start_ts`/`end_ts` are UTC instants of local midnights (Stockholm summer =
  `T22:00:00Z` the day before). `end_ts` is exclusive, so "Ends today" means `end_ts` = tomorrow's
  local midnight (#1068).
- **`timezone` is only validated as a non-empty string** — `"Not/A_Zone"` is accepted, which is
  what the page's `formatInZone` try/catch fallback exists for. A `Pacific/Auckland` or
  `America/Los_Angeles` challenge is the discriminator proving dates render in the _challenge's_
  zone rather than the viewer's (#1068).
- **Multi-user podium fixtures** (#1073): sign two extra users up with one curl each, seed steps on
  different days, and create windows that pick different winners (host wins / rival wins / exact
  tie). Joining with the other users' tokens registers `kind='local'` members computed in-process,
  with no SSRF involved.
- **Steps seeding rejects `source: "manual"`** ("cumulative/derived … only queryable from
  [health_connect_aggregate, aurboda]"). Omit `source` on `POST /api/metrics/bulk` and it defaults
  to `aurboda` (#1073). The bulk body key is **`data`**, not `items` (#1089).
- **Land a daily aggregate on the challenge start**: create the challenge with `timezone: "UTC"`
  and UTC-midnight bounds, then `POST /api/sync/daily-aggregates {data:[{metric:'steps',date,value,data_origins:['x']}]}`
  without a timezone — it stores at UTC midnight (#1089).
- **Activity-type spec**: `pattern` is the activity type _name_ (`walking`), `aggregation:"count"`,
  `unit` free text. There `last_updated` stays the activity `start_time`, not the write time
  (#1089).
- A **stale remote member** (#1073): insert a `challenge_members` row with `kind='remote'`,
  `identity_base_url` pointing at a host sink, `cached_total` and `data_endpoint_url`; safe-fetch
  refuses the private address → `stale: true`, and a challenge that ended ≥ 24 h ago is announced
  anyway (`STALE_ACCEPT_AFTER_MS`). Multi-member standings can also be seeded straight into
  `challenge_members` with `cached_buckets`/`cached_total` and `last_fetched_at = now()` — the
  5-minute TTL short-circuits the network fetch.

### The winner-announcement sweep (#1073)

**Ride the real cron instead of probing.** `pgboss.schedule` in the central `aurboda` database
holds the row (`challenge-results-queue.ts`, `*/10 * * * *`); the job is created at `:x0:04` and
picked up ~30 s later (`pollingIntervalSeconds: 30`). Seed everything first, then create
challenges with `end_ts` inside `(now − 3 d, now − 6 h]` and poll `GET /api/challenges` for a
non-null `result_published_at`. **Pre-existing challenges that ended inside that window get swept
too** — plan around them.

Winner-inbox delivery is not observable without the wrapped-`lookupObject` probe (see _In-container
probes_): `lookupObject` refuses private addresses, so the app logs
`⚠️ … delivery to @x@localhost:8080 skipped: actor not resolvable`. Worse, a dead `feed_follower`
row makes the followers `sendActivity` throw **before** `deliverToMentioned` runs (#1079) — park
that row with `accepted=false` for a clean control run.

### Discovery and remote peers (#1091, #1101)

- **Followees are seeded straight into `feed_following`** (columns `id, actor_uri, inbox_uri,
shared_inbox_uri, handle, display_name, avatar_url, accepted, created_at, notify_on_post`). A
  local followee is `http://localhost:8080/users/<u>` and matches `WEB_HOST`, so it is listed
  in-process. A followee on a host whose `/.well-known/aurboda` 404s is silently "not aurboda".
- **A fake remote peer**: `safe-fetch` refuses RFC1918 and loopback but **not** `203.0.113.0/24`
  (TEST-NET-3), so a sink container on a dedicated docker network at `203.0.113.10:8080` serving
  `/.well-known/aurboda`, `/api/public/<user>/dashboards`, `/api/public/<user>/<slug>` and
  `POST …/<slug>/members` is a working peer for **discovery and joining**. It is _not_ usable for
  anything Fedify must `lookupObject`, which refuses TEST-NET-3 as reserved (#1104). The app
  container drops off an extra network on every compose re-up — `docker network connect <net>
<app container>` again (it survives a plain `docker restart`). **(untested here: the network and
  container names differ under this project.)**
- Sub-path bases on the sink (`/r429` answering 429 after 1.2 s, `/r403`, `/r404`) give the
  transient-vs-definite well-known variants, and followee rows are
  `http://203.0.113.11:8080/<sub>/users/<n>`.
- **Probe-classification oracle** = the sink log across two rounds: a definite failure (404) is
  probed once then memoised, while transient ones (429/403/500, DNS `ENOTFOUND`, `EHOSTUNREACH`,
  `timeout of 8000ms`) are re-probed every round and each logged as
  `⚠️ Challenge discovery: could not list …`. A fresh memo needs an app restart (~4 s).
  `peers_unreachable` counts distinct **bases**, so 9 failing followees on 5 hosts gives 5.
- A DNS failure throws a plain `Error('Host did not resolve')` rather than an AxiosError, which
  before #1101 meant it was memoised as not-aurboda for an hour, uncounted and unlogged (#1094).
- **Tombstone flow** (#1101): join → leave writes `challenge_left(challenge_url)`; rejoining
  clears it with a new participation id; a 502 join (the host 403s `/members`) leaves neither a
  participation nor a tombstone. Before that fix, leaving simply deleted the row so the challenge
  was re-suggested (#1093). Joining `…/<slug>?embed=1` fetches the canonical URL and stores that;
  `…/#ref` and an uppercase `HTTP://LOCALHOST:8080/u/<host>/<slug>?embed=1` are idempotent and
  lowercased; legacy `?embed=1` rows patched in by hand are still hidden because readers
  canonicalise.
- Residual: the in-flight memo only dedupes _concurrent_ followees, so a slow transient host with N
  followees still gets up to N probes per round (#1102).

### `/challenges` page DOM

- Hosted row `li.challenge-row` (walking up from `.btn-danger` overshoots into the group);
  discovery rows live under `.challenge-group-discover` > `li.challenge-row` with badge "Open to
  join", meta `<host label> · <pattern> · <aggregation>`, actions `a.btn-secondary` View and
  `button.btn-primary` Join, plus `.challenge-discover-note` for unreachable peers. Joining moves
  the row out of the section into Ongoing as Joined.
- `label.challenge-row-toggle input` is the announce toggle — hidden once `result_published_at` is
  set, but shown forever on challenges older than three days (#1078), and the label is unreadable
  in dark mode (#1077).
- Podium on a feed card: `.challenge-podium-entry.challenge-podium-rank-N` with
  `.challenge-podium-medal`/`-name`/`-total`. Public page: `.challenge-final` + `tr.challenge-winner`
  - `td span[title="#1"]`. Followers-only result posts 404 on the object dispatcher and are absent
    from `/u/<user>`.
- The public page renders `td.challenge-member-updated` as
  `new Date(last_updated).toLocaleTimeString()` — use `page.emulateTimezone('UTC')`, because after
  local midnight in Stockholm the cell reads `00:3x:xx`, which looks exactly like the bug you are
  testing for, and compute the expected string inside `page.evaluate` for a locale-proof
  comparison (#1089).
- **Empty-group branches** (Upcoming and Ended only render when non-empty; Ongoing has an empty
  state) are drivable without deleting anything: `setRequestInterception` and answer
  `/api/challenges` with a chosen list and `…/participations/mine` with `{success:true,participations:[]}`
  (#1068).
- **Challenge-zone day counts** (#1070) need the viewer's zone as the second variable
  (`page.emulateTimezone`): with the viewer _behind_ the challenge zone and both on the same
  calendar date, "Starts" discriminates; with the viewer _ahead_, "Ends" does; a Pago Pago (−11)
  challenge discriminates "Ends" for both. Compute both the old and the new formula in the script
  with `Intl.DateTimeFormat(...).formatToParts` and assert DOM == new ≠ old. The New-Year label is
  `Dec 28, 2026 – Jan 4, 2027` (en-US).
- CSS oracles: discovery Join `button.btn-primary` and View `a.btn-secondary` are both 38px with
  `align-self: stretch` (#1097 was Join at 27px); `.challenge-create .visibility-selector
.visibility-option` must compute `flex-direction: row` while `.challenge-create > label` is
  `column` (#924/#1095); dark badge `rgb(252,211,77)` on `rgb(90,58,10)`, note `rgb(156,163,175)`,
  toggle `rgb(209,213,219)`, create-form `small` `rgb(156,163,175)`.
- `.challenge-row-actions` has no `flex-wrap`, so hosted rows still overflow a 390px phone by 32px
  (#1088).

---

## Sync and integrations

**No provider credentials exist here.** Everything below drives the real merged code with a fake
transport, in-container.

### Garmin (#976, #1081)

`processGarminData(user, 'activities', data)` can be called with the **deps argument omitted** —
`defaultDeps` are the real DB functions, so it writes straight into `aurboda_<user>`. Records look
like `{activityId, activityName, activityType:{typeKey}, startTimeGMT:'YYYY-MM-DD HH:mm:ss', duration, …}`.

Confirmed behaviour worth reusing as fixtures: `rowing_v2` → `rowing` (version-suffix strip),
`indoor_rowing_v2` → `rowing_machine` (an override applies **after** the strip), an unknown
`kitesurfing_v3` → `other_workout` with `data.garmin_type_key` preserved, and a >255-character
title fails only its own activity (an `audit_log` error `Failed to process Garmin activity <id>`)
while the rest of the batch lands. `⚠️ auditWarn` fires once per distinct unmapped typeKey.

### GPS and locations (#977)

- `processActivityDetail` runs the same way in-container. A fresh demo user has no
  garmin/strava activities, so `resync-detail` and a real sync cannot be driven.
- OwnTracks ingest is `POST /api/ownTracks` with HTTP **Basic auth using the user's database
  password** — the demo `password` in `state.json`, which is also the web login.
- The read path the ActivityMap uses is `GET /api/locations/raw?start=…&end=…` (bearer), which
  filters `deleted_at IS NULL`; `/detail/activity/:id` fetches exactly the activity span.
- Confirmed: a full-activity-span soft-delete of non-track sources clears edge phone points
  outside the downsampled track, strava is spared (`activityTrackSources` never supersede each
  other), and `🛰️ auditInfo` records the replaced count, span and activity id. **Mismatch found**:
  the #977 body claims `insertLocations` revives soft-deleted rows on conflict; the merged code is
  `ON CONFLICT DO NOTHING` (#978).

### Gravl (#1081, #1087)

`integrations/gravl/client.ts` takes `{ http }` (an AxiosInstance) as an override, so the real
`syncGravlWorkouts` / `enrichGravlWorkout` / `processGravlWorkout` run in-container against the
demo database with `axios.create({ adapter })` serving fixture list pages and details.

**The trap that costs a round trip**: a custom adapter bypasses `validateStatus`, so a resolved
`{status: 429}` is treated as a 200 body (`listed.items is not iterable`). Throw
`new AxiosError(msg, AxiosError.ERR_BAD_REQUEST, config, null, response)` for 4xx/5xx or the
429/404 paths are never exercised.

The personal-token path resolves through the real `getSettings`, so
`PATCH /api/user/settings {gravl_api_token}` first. Weight conversions: 95 lb → 43.091 kg, 135 →
61.235, 70 → 31.751 (÷ 2.20462262, 3 dp). Outcomes: fresh → `created`, again → `updated`, an
"HC-born" row (`insertActivity(source:'gravl', external_id: gravlWorkoutExternalId(id))` without
sets) → `enriched` then `updated`; `workouts_processed` counts updated rows while
`activities_enriched` counts only HC-born ones. A headerless 429 sets `sync_state.retry_after =
now + 5 min`; enrichment under the hold returns `'skipped'` with zero Gravl calls and an audit row
`Gravl enrichment skipped - rate limited`. Token-refresh sharing: a client with an expired grant
and a 300 ms token adapter, 3 concurrent `getAccessToken` calls → 1 POST and one shared token, a
4th call → a second POST.

**The container has outbound internet**, so a fake token against the real API gives a genuine
`Gravl API 401 — Unauthorized` — which doubles as a scheduler oracle (`audit_log`
`Auto-syncing Gravl workouts` + `Gravl sync failed` per tick, and `source-enrich` jobs going to
`retry` with the 401 in `output`).

### Health Connect (#1080/#1081, #927)

- `POST /api/sync/ExerciseSessionRecord {data:[…]}` with `metadata.dataOrigin`
  (`com.liteup.getgains` / `com.garmin.android.apps.connectmobile` / anything else) and
  `clientRecordId` (`gravl-session-<uuid>` or a numeric Garmin id); `SleepSessionRecord` with
  `clientRecordId` = local-midnight epoch ms and `+02:00` timestamps → `garmin-sleep-<local date>`.
  Re-sending the same batch is idempotent on rows.
- `GET /api/activities?start=&end=` (**not** `start_date`) answers `{data:[…]}` and **requires full
  ISO datetimes** (`2026-07-20T00:00:00Z`); date-only → 400 "Invalid ISO datetime". Merged rows
  carry `merged:<id>` ids, `comments` = notes, and the union of the merged sources' fields.
- **Large bodies** (#927): `POST /api/sync/daily-aggregates` with `{data:[{metric:'steps',date,value,data_origins:[…]}]}`
  on unique dates, scaled to bracket 64 KB. 181 KB answered `200 {"success":true}` in ~4.7 s,
  scaling ~2.6 ms/record — parsing and real upsert work, not the old indefinite hang. The
  companion check is that federation still routes: `GET /users/<user>` with
  `Accept: application/activity+json` → `200 application/activity+json`; an unsigned
  `POST /users/<user>/inbox` → `401 "Failed to verify the request signature"` (that 401 is
  _Fedify_ answering, so the raw body reached it — a 404 or a JSON error would mean the gate broke
  federation); `GET /u/<user>` → `200 text/html`, correctly not captured.

### The pg-boss scheduler (#1081)

pg-boss lives in the **central `aurboda` database**: `pgboss.schedule` (e.g.
`sync-scheduler */5 * * * *`), `pgboss.job` (`state`, `singleton_key`, `start_after`, `retry_count`,
`output`, `started_on` — an identical `started_on` means the same batch) and `pgboss.queue.policy`.
Interval oracle: seed `sync_state.last_sync_time` in the per-user DB to a chosen age, set
`sync_intervals` through `PATCH /api/user/settings`, and check whether the next tick logs the
auto-sync. On error `last_sync_time` is preserved (a COALESCE in `upsertSyncState`);
`DELETE /api/sync/gravl/state` resets the status but keeps it. Seed `sync_state` to `rate_limited`
by SQL to see `GET /api/sync/gravl/status` fold it to `status:"error"`.

Findings from that area, still worth knowing: `singletonKey` is ignored on a `standard` pg-boss
queue (#1082), a batch handler that throws fails **every** job in the batch (#1083), and the admin
page shows a relative redirect URI (#1084).

### Non-blocking analyze endpoints (#966)

`getHrvActivitiesCorrelation` and `getActivityImpact` fire their provider syncs
fire-and-forget (`triggerCorrelationSyncs`, `Promise.allSettled`) and return from the database
immediately.

- `GET /api/correlations/hrv-activities?tz=Europe/Stockholm&period_days=90&context_metric=hrv_rmssd`
- `GET /api/correlations/activity-impact/:activity?tz=…&activity_type=activity_type&period_days=90&window_minutes=30`
- Also on that router: `/baseline`, `POST /generic`, `POST /continuous`, `POST /event-probability`,
  `/selectors`.

**The limitation is the point**: the providers those endpoints sync (oura, rescuetime, calendar)
are disconnected here, so the `*IfNeeded` syncs are no-ops and the _old_ blocking code would have
been fast too. There is no black-box timing difference to observe; the honest verdict is "the
changed endpoints still return correct data immediately" (16–46 ms), not a measured speedup.
`event-probability.ts` keeps the blocking pattern on a different sync set, by design.

---

## Auth, login and schema

### Signup, login and tokens

- `POST /api/signup {username, password[, invitation]}` → `{success, token, is_admin}`. The first
  user on the instance becomes admin. Username must match `^[a-z][a-z0-9_]{2,30}$` and avoid
  `RESERVED_USERNAMES`; an existing name → 409.
- `POST /api/login {username, password}` → `{token, is_admin}`. The password is the user's
  **Postgres role password**: login is a real connection attempt, so only a password Postgres
  itself rejects (28P01) is a 401, and anything else is a 503.
- `GET /api/version` → `{build_sha, success}` — the merge-commit check. `GET /api/status` →
  `{signup_mode, signup_allowed, federation, product, version}`.
- `GET /api/auth/token` (bearer) mints a fresh token.
- Web: `/login` has `#user`, `#pass` and `button[type=submit]`; a wrong password shows a red
  "Unauthorized".
- OAuth: `POST /register {client_name, redirect_uris}`, then a form `POST /authorize`. A wrong
  password returns 200 HTML containing "Invalid username or password"; a correct one returns 302
  with `Location: …?code=`.

### Statement-level oracle (#1124, #1126)

`ALTER DATABASE aurboda_<user> SET log_statement = 'all'` — **run it on its own**. `psql -c` sends
several statements as one transaction, so an invalid second one rolls the first back. Restart the
app so new sessions pick the setting up, then read the postgres container's log, which goes to
stderr.

- `docker … logs --since/--until` taken right after a curl **misses lines**: the log flushes late.
  Pull the whole log since the restart and order it by timestamp.
- `FATAL: database "aurboda_service" does not exist` every 5 s is the `pg_isready` healthcheck,
  not the app.
- Counting `FATAL: password authentication failed for user "X"` shows each attempt really reached
  Postgres.
- Sessions opened **before** the ALTER never log — that is why a fresh-signup probe can show zero
  statements. Use response time and marker rows instead.
- `RESET log_statement` when done.

### Cache-warm state and error classification (#1124)

- `pg_stat_activity` filtered on `datname='aurboda_<user>'`: after a restart plus one bearer
  request, `aurboda_service=1` (`getDbForUser` uses `SET ROLE`, so `usename` stays the service
  role); a login on a cold cache instead gives `<user>=1`. Leaked throwaway clients would show as
  extra `<user>` rows.
- `ALTER ROLE <probe> CONNECTION LIMIT 0` makes a _correct_ password fail with 53300 while a wrong
  one still gets 28P01 (authentication is checked before the limit), and login answers
  `503 {"success":false,"error":"Service unavailable"}`. Restore with `-1`.
- `docker … pause postgres`: new connects fail at 10.006 s with `timeout expired` (`/authorize`,
  `/api/ownTracks`); a cold-cache bearer request fails at 20 s (the middleware migration and the
  route each time out); `/login` hangs for the whole pause, because its `pg_user` lookup runs on
  the existing central client, which has no query timeout. The auth middleware remembers a failed
  migration for the rest of the process — **restart the app after a pause test**.
- An empty password is rejected before Postgres on `/api/login` and `/api/ownTracks`.

### Schema migration (#1003, #1126)

**An `ALTER` in `apps/backend/src/schema/<domain>.ts` is dead unless its key is also in
`tableCreationOrder` in `apps/backend/src/schema.ts`.** `db/connection.ts` only ever iterates that
array. CI cannot catch the gap, because the base `CREATE TABLE` usually gains the column inline in
the same PR and the integration tests build a fresh database from the same array — so the additive
path is never exercised. On any PR that adds a column, the first check is one grep:

```sh
dc exec aurboda grep -n "<table>" /app/apps/backend/src/schema.ts
```

Symptom to recognise: `column "x" does not exist` from every read **and** write, the web stuck on
`Loading…`, and the public profile claiming "no public posts". The `_isSchemaError` auto-heal
re-runs the same incomplete list, so each request pays a full migration pass and still fails —
which is how a 500 becomes a 504 on slower endpoints (#1003).

**Verifying a fix for that class** (#1006): the tryout database usually already has the column, so
build the A/B yourself — copy `schema.ts` out, delete the key with `sed`, copy it back, restart,
`ALTER TABLE … DROP COLUMN` on the user DB (back the values up first), hit the endpoint for the
exact production 500 twice with `Schema error … running migration and retrying` in the log both
times, then put the shipped file back and restart: the column is _still_ missing (a deploy alone
does not migrate) and the **first** request heals it and returns 200. Pair it with an in-container
probe importing `./schema.ts` that recomputes the `schema.test.ts` invariant.

**The fingerprint gate** (#1126): `dc logs aurboda | grep 'Schema sweep done'` prints
`N migrated, N already current, N failed` about 10 s after `Running on localhost:3000` on a first
boot (one user per second, sequential) and ~80 ms on a re-boot, with
`Schema for <u> already at <hash>, skipping migration` per user. The marker is `schema@<16-hex>` in
`schema_migrations` of every `aurboda_<user>` database, append-only.

One-restart fixture matrix: `UPDATE schema_migrations SET name='schema@stale0000deadbeef'` in one
user database → that user is `migrated` and gets a second row appended (history kept);
`ALTER TABLE schema_migrations RENAME COLUMN name TO nom` in another →
`⚠️ Schema migration failed for <u>: column "name" does not exist`, counted as `failed`, and the
sweep continues. Rename it back.

Forced repair: `SET ROLE <user>; DROP TABLE notes CASCADE` (tables are owned by the user role and
the service role is superuser, so it can `SET ROLE`), then a bearer
`GET /api/notes?from=<ISO>&to=<ISO>` — the app logs
`Schema error for user <u>, running migration and retrying`, the statement log shows ~350
statements even though the marker is still present, the table is back and the response is 200. A
gated first request otherwise issues exactly `CREATE TABLE IF NOT EXISTS schema_migrations` plus
`SELECT 1 FROM schema_migrations WHERE name=$1`, and `/login` issues no schema statements at all.

Known gap: **signup records no fingerprint**, so the first request after a signup sweeps (#1128).

### Settings

- `GET`/`PATCH /api/user/settings`. There is no `PUT /api/settings`.
- `PATCH /api/admin/settings {signup_mode}` (admin) flips `/nodeinfo/2.1` `openRegistrations`
  (#1050). `tz` is **not** a PATCH-able setting and is silently ignored.
- `null` clears a key from the settings JSON since #1087 (`select settings ? 'key' from
user_settings` is the oracle). Before that it was a silent no-op for every scalar setting,
  because `validateAndUpdateSettings` mapped null→undefined and `upsertUserSettings` filtered
  undefined out (#1063/#1085).

---

## Public profile and sharing

### `/u/:username` (#906, #916, #940, #1052)

The public profile is unauthenticated, has no app chrome, and renders **both** sharing surfaces on
one page — the cheapest way to check feed and profile CSS without auth:

- `.public-profile-header` (a `<div>`, not a `<header>`) = avatar + `<h1>@handle</h1>` +
  `margin-left:auto` `.share-link-btn`.
- One `FeedPostCard` per public/unlisted post, each with a semantic `<header class="feed-post-head">`.

APIs to check first: `GET /api/public/<user>/dashboards` and `GET /api/public/<user>/posts`.

`.public-profile` is `box-sizing: border-box; width: 100%` since #952. The oracles that caught the
original bug, across 320/360/390/414/480: `boxSizing === 'border-box'`, profile border-box width
=== `innerWidth` (0px overflow, was +48px), and the Share button's right edge at
`innerWidth - 24px` instead of `innerWidth + 24`. There was no horizontal scroll
(`scrollWidth === innerWidth`), so the overflowing strip was simply clipped — the screenshot showed
"Shar".

### Enriched public posts (#1052)

- **The A/B for "is the enrichment doing anything"**: `page.setRequestInterception(true)`, refetch
  `/api/public/<user>/posts` yourself, delete each post's `structured`, and respond. The same card
  falls back to a stat grid plus `.feed-post-image` chart.png/route.png; with `structured` it
  renders `.timeline-structured` + `.timeline-chart svg` + `.activity-map-container` and **zero**
  static images.
- **Hover proof**: `page.mouse.move` across the chart svg at 25% and 75% width, then read the
  tooltip text and `getComputedStyle('.activity-map-highlight').transform` — a changed matrix is a
  time-synced map.
- **LRU cold/warm**: the readiness poll must **not** hit `/posts` or it warms the cache. Cold
  274 ms vs warm 42 ms for 20 posts (9500 route points, 4560 samples, 1.1 MB, `no-store`).
- Cache correctness is drivable: editing a post's message or series is reflected instantly
  (`updated_at` is in the key); flipping it to `followers` removes it from the listing and the
  per-post endpoint 404s anonymously.
- Article posts are excluded (`kind === 'activity'` gate), and `ArticleChartBlock` fetches the
  **authenticated** `/api/metrics/bucketed`, so a visitor gets "Couldn't load this chart." (#1054).

### Visibility (#923)

The public field on challenges and shared dashboards is `visibility` (`ShareVisibility` =
`public`/`unlisted`), **not** `is_public`; it is stored as an `is_public` boolean and mapped at the
boundary in `services/visibility.ts`. The default when omitted is `unlisted`, a legacy `is_public`
in the body is ignored, and `visibility:"followers"` is rejected 400 for challenges and dashboards
(that value is feed-only). Shared dashboards: `POST`/`GET /api/shared-dashboards`, **PUT**
`/api/shared-dashboards/:id`; the public dashboard view does not expose visibility, only the
challenge one does.

`<VisibilitySelector>` renders `fieldset.visibility-selector` with `.visibility-option` rows (radio

- `strong` + `.visibility-hint`) in three places: the `/challenges` "New challenge" form (full, 2
  options, radio-group `challenge-visibility`), `/shared-dashboards` per-row (compact, no hints,
  `dashboard-visibility-<id>`), and the activity-detail Share dialog (full 3-option feed variant,
  `feed-visibility`).

### Avatars (#1053)

- `POST`/`DELETE /api/profile/avatar`, multipart field `avatar`.
- Actor icon oracle: `curl -H 'Accept: application/activity+json' "$BASE/users/<u>" | jq .icon.url`
  — an identicon is a bare `/u/<u>/avatar.png`, and after an upload it is `?v=<updated_at ms>`
  matching `select extract(epoch from updated_at)*1000 from profile_avatar`. Stable across
  refetches, changes on every re-upload, back to bare on DELETE. WebFinger's
  `http://webfinger.net/rel/avatar` href versions the same way. `?v=` is only a query param, so an
  old URL still serves the current image (`Cache-Control: public, max-age=3600`) — no 404 risk for
  peers.
- The embedded `Person` in a delivered `Update` matches the served actor document
  property-for-property (only `@context` differs, since Fedify adds the LD-signature terms) — the
  #1040 dehydrator only clobbers `toJsonLd` _instance patches_.
- Rejected uploads (a text file, or no file → 400) fire **no** Update: assert the sink's line count
  is unchanged.
- Settings UI: upload through `.avatar-settings__upload input[type=file]` + `uploadFile`, then read
  the centre pixel of `.avatar-settings__preview`'s canvas to prove the new image. The UI already
  cache-busts its own preview with `?t=`.

---

## Android and widgets

**None of this runs in the cloud environment as it stands**: there is no Android SDK, and the
Robolectric and Kotlin recipes below need a JDK plus Gradle or the Kotlin compiler jars. They are
kept because they are the only way these surfaces have ever been verified, and because the
environment could be given a JDK. Mark any Android claim "not run" unless you actually ran it.

### Robolectric against the live server

Android features **are** live-verifiable without an emulator: run the shipped Kotlin under
Robolectric against the tryout server.

- Build a read-only harness from `git archive <merge-sha> apps/android`, plus
  `packages/api-spec/generated/kotlin` (gitignored — take it from a tree where it has been
  generated) placed so the relative
  `../../../packages/api-spec/generated/kotlin/src/main/kotlin` srcDir resolves, plus
  `local.properties` with `sdk.dir`.
- `./gradlew :app:testDebugUnitTest --tests '*MyTest*'` — ~15–40 s with a warm Gradle cache. Test
  code must be warning-free (`-Werror`).
- Gotchas, each of which cost a round trip:
  - `CredentialsManager` uses EncryptedSharedPreferences → `KeyStoreException` under Robolectric.
    `mockkObject(CredentialsManager)` + `every { getCredentials(any()) } returns Credentials(...)`
    (mockk is already a test dependency); read the bearer from `$TRYOUT_DIR/token.txt`.
  - `ShadowAppWidgetManager.createWidget()` fires `onUpdate` → "WorkManager is not initialized".
    `WorkManagerTestInitHelper.initializeTestWorkManager(context, Configuration.Builder().setWorkerFactory(<noop factory>).build())`
    — the noop factory also stops the provider's own enqueued refresh from re-applying RemoteViews
    onto the same view, which otherwise shows as duplicated/interleaved leaderboard rows.
  - `manager.updateAppWidgetOptions(id, bundle with OPTION_APPWIDGET_SIZES=[SizeF(w,h)])`
    round-trips, so one render per launcher size.
  - PNGs need `@GraphicsMode(GraphicsMode.Mode.NATIVE)`; then measure and lay
    `shadowOf(manager).getViewFor(id)` out at exactly w×h px and `view.draw(Canvas(bitmap))`.
  - Compose: `captureToImage()` times out under Robolectric (PixelCopy) — use
    `createAndroidComposeRule<ComponentActivity>()` and draw `activity.window.decorView`. The
    Robolectric window is only 320×470, so LazyColumn items past about the second are not composed
    and `assertIsDisplayed` on later rows fails spuriously.
  - `sendBroadcast()` is **not** routed to manifest-declared receivers; call
    `Provider().onReceive(context, intent)` directly.
  - Permission screens: `shadowOf(context.getSystemService(NotificationManager::class.java)).setNotificationsEnabled(false)`
    flips `NotificationManagerCompat.areNotificationsEnabled()`; `shadowOf(context).nextStartedActivity`
    verifies the settings button launches `ACTION_APP_NOTIFICATION_SETTINGS` with
    `EXTRA_APP_PACKAGE`; drive the on-resume re-check with
    `CompositionLocalProvider(LocalLifecycleOwner provides owner)` and a `LifecycleRegistry`
    (CREATE→START→RESUME, PAUSE, flip the shadow, RESUME + `waitForIdle()`).
    `shadowOf(app()).grantPermissions(POST_NOTIFICATIONS)` needs the **application** context, not
    the activity; the denial path is
    `activity.onRequestPermissionsResult(shadowOf(activity).lastRequestedPermission!!.requestCode, …, intArrayOf(PERMISSION_DENIED))`
    with `@Suppress("DEPRECATION")`.
  - `performScrollTo()` throws "no parent layout with a Scroll SemanticsAction" on a plain
    `Column` — drop it; use `onAllNodes(hasText(x)).fetchSemanticsNodes().size == 0` for absence.
  - **The A/B that proves it really reads the server**: flip every follow's `notify_on_post` off
    → the enable test fails; restore → it passes.

### Pure-JVM Kotlin without Gradle (#1061, #1073, #1091, #1104)

`ChallengeWidgetModel.kt` and `PostNotifications.kt` are pure JVM, so compile them standalone
against jars already in the Gradle cache and feed them live API JSON:

```
java -cp <kotlin-compiler-embeddable>:<kotlin-stdlib>:<kotlinx-coroutines-core-jvm>:<kotlin-reflect-2.x>:<annotations> \
  org.jetbrains.kotlin.cli.jvm.K2JVMCompiler \
  -Xplugin=<kotlin-serialization-compiler-plugin-embeddable> \
  -classpath <serialization-json + core + stdlib> -d out …
```

All four extra jars on the **compiler** classpath are required (each missing one is a separate
`ClassNotFoundException`), and `kotlin-reflect` must be 2.x. ~5 s per run. Bring the generated
models along (`Challenge*`, `ChartDataBucket`, `ShareVisibility`, `DiscoveredChallenge`), and
decode live JSON with `Json { ignoreUnknownKeys = true }`.

**Print the old decision beside the new one in the same probe** — that A/B is what shows a fix. A
row `published 09:30 / received 13:00` with a high-water mark of `12:00` is notified by the
received_at-aware logic and by nothing under the old published_at-only one (#1061). For the
involvement rule, the A/B is `sourceActorUri` vs `actorUri`: a boost by a followed booster of an
unfollowed author notifies under the new logic and not the old, while a muted followee's boost is
silent in both (#1104). For the widget: Keep under 24 h after the end, Advance at 24 h + 1 min to
the running pick ending soonest, Advance at once for an unknown URL, Suggest(fallback) far-future,
`bucketEndAt` of a 1d Stockholm DST day = 25 h (#1091).

---

## Performance and windowing

- **The windowing oracle seed**: to prove a range really is windowed rather than that the endpoint
  returns 200, seed series points **inside and outside** an activity's `[start_time, end_time]`,
  with outside values chosen so a full-series scan yields a visibly different number. Elevation
  `1000,500` before / `100,150,120,170` inside / `900,50` after gives a windowed gain/loss of
  `100/30` against an unwindowed `830/1780`. Put a `0` inside to check the positive-only filter,
  and a sample exactly _on_ each edge to check inclusivity. One request then discriminates a dozen
  fields at once (#984).
- **Merge-collapse gotcha**: seeding N short activities that all overlap one long pre-existing
  `exercise` row makes `getActivities` fold them into a single `merged:<uuid>` result — the
  per-activity cost vanishes and the perf test silently measures nothing. Seed into a range with
  no long overlapping activity.
- **`activities.source` must be a value from `dataSourceSchema`** (`manual`, `garmin`, `aurboda`,
  …) or the _response_ schema rejects the row with `Invalid DataSource: "…"`. `time_series.source`
  is unvalidated, so any label works there.
- **A/B attribution by patching the container**: the image only ships the new code, so copy the
  file out, patch it, copy it back and restart (the writable layer persists), re-time, then
  restore and restart. Combine it with an in-container probe that imports the real module and runs
  it beside a verbatim copy of the pre-change implementation over the same real series — that
  gives parity (0 mismatches) and old-vs-new timings in one shot.
- **Event-loop blocking is directly observable**: poll `/api/version` in a tight loop while the
  slow request is in flight. `code=000` from `curl -m 5` means the single thread never got a turn
  — the actual outage symptom, not a proxy for it.
- **A web layout A/B without a rebuild** (#1058): the SPA is one minified bundle served by nginx
  (`/usr/share/nginx/html/assets/index-<hash>.js`, named in `GET /`). `curl` it, string-replace the
  changed helper with the old implementation, and serve the patched copy through
  `page.setRequestInterception` + `req.respond` for `/\/assets\/index-.*\.js$/`. Only your browser
  sees it and nothing in the container is mutated. Minified helpers stay greppable — the right
  margin shipped as `mT=e=>e===0?14:e*45+20`, the tick clamp verbatim as
  `Math.max(3,Math.min(6,Math.floor(f/60)))`. Reproducing the reported bug with the old constants
  is what makes the "after" number mean anything.

---

## Traps

- **`/feed` never reaches `networkidle0`.** The SSE stream is a persistent connection, so
  `waitUntil: 'networkidle0'` times out. Use `domcontentloaded` plus a sleep, or
  `waitForSelector('article.feed-post')`.
- **fullPage screenshots are often useless.** The app scrolls in an inner container, so
  `fullPage: true` returns just the viewport. Use `elementHandle.screenshot()` (puppeteer scrolls
  it into view) or `el.scrollIntoView({block:'center'})` plus a plain viewport shot.
  `page.screenshot({clip})` uses document coordinates and lands in the wrong place. On `/feed`,
  `element.screenshot()` on a `.feed-post` also lands on the wrong content — scrollIntoView plus a
  full-viewport shot is the reliable pair. For a section below the fold, a 1400px-tall viewport
  plus `fullPage` works.
- **Dark mode**: headless Chromium here renders the app **dark** by default; emulate `light`
  explicitly for a light shot. `page.emulateMediaFeatures` is not reliably applied to
  `page.screenshot({fullPage:true})` rasterisation, though **element** screenshots do honour it.
  Assert on `getComputedStyle` rather than eyeballing a fullPage shot. The app drives its theme
  straight off `prefers-color-scheme` — there is no `.dark` class or `data-theme` — so
  `matchMedia('(prefers-color-scheme: dark)').matches` in `page.evaluate` confirms the emulation
  took.
- **`psql -c "a; b; c"` runs as ONE transaction** — an error in `b` silently rolls `a` back, so a
  cleanup can look done and not be. One statement per `-c`.
- **Flatten SQL whitespace** when shelling out to psql from node (`sql.replace(/\s+/g,' ')`):
  double-quoted shell arguments keep literal `\n` and break psql.
- **`curl -F` multipart uploads 500 with `{"error":"Unexpected end of form"}`** because of curl's
  default `Expect: 100-continue` through nginx into busboy. Add `--http1.1 -H "Expect:"`. It is a
  curl↔nginx artifact, not a product bug — browsers do not send that header.
- **`GET /api/activities` and `GET /api/notes` need full ISO datetimes.** A date-only `start`
  answers 400 "Invalid ISO datetime".
- **Typing into a textarea and clicking the submit button immediately drops the last character**
  (a Preact render race, not a bug). Type with `{delay: 40}` and sleep before clicking.
- **Re-`evaluateHandle` a button immediately before clicking**: re-renders detach handles taken
  before typing.
- **Seeded rows outlive the tryout.** Every fixture inserted by psql or the API stays until
  deleted, and a stale `feed_follower` row makes every later share retry a dead inbox — which can
  abort a whole fan-out (#1079). `--fresh` is the real answer; explicit cleanup is the answer when
  you cannot use it.
- **Port collisions between sinks**: the old rig had parallel sessions fighting over `:9099`. Pick
  a free port and delete the row that points at it when you are done.
- **A bare-`node -e` script cannot import a workspace dependency.** Bare specifiers resolve by
  walking up from the importing file, and an `-e` script has no path. Write the probe to a file
  under `/app/apps/backend/src/` and run it from `/app/apps/backend`.
- **Before filing, read the PR's review follow-up issue.** It regularly already covers what a
  tryout is about to file.
