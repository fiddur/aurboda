---
slug: "302f"
authors: Fredrik Liljegren <@fiddur@aurboda.net>
status: DRAFT
discussionsTo: https://socialhub.activitypub.rocks/t/fep-302f-quantpub-federated-personal-metrics-for-quantified-self-sharing/8919
dateReceived: 2026-10-02
trackingIssue: https://codeberg.org/fediverse/fep/issues/942
---

# FEP-302f: QuantPub — federated personal metrics for quantified-self sharing

## Summary

QuantPub is a small, vendor-neutral extension to [ActivityPub] for sharing
personal quantified-self data — workouts, sleep, heart-rate variability, steps,
mood — between federated instances **and** home-built personal tools, without
giving up mainstream-fediverse compatibility or the author's control over what
leaves their instance.

It has three parts:

1. A tiny **vocabulary** (`quant:Exercise`, `quant:Observation`) that attaches
   typed scalar summaries in canonical units and a bounded time window to an
   ordinary AS2 `Note`, so Mastodon-class servers render a readable status
   while implementing peers read machine-readable data.
2. An **out-of-band structured-payload pattern** — a well-known discovery
   document plus two public HTTP endpoints — because typed vocabulary
   extensions are, in practice, dropped by mainstream fediverse software. This
   channel is the interoperable core of the proposal.
3. **Privacy principles as normative requirements**: every element of a share
   is the author's choice, scalar summaries never imply series access, series
   and geography are separate choices, unshared data is
   indistinguishable from nonexistent data, and revocation is immediate.

A home-built tool interoperates by implementing the discovery document and
the two endpoint contracts — no ActivityPub actor required — and can grow into
full federation later.

## Motivation

Sharing a workout is a social act. On Strava, Garmin Connect and their peers a
run shows up in followers' feeds as a card: a map, a few headline stats, a
heart-rate chart, room for kudos and comments. That is what people want from
fitness sharing, and it is why those platforms hold the data.

The fediverse already has the social half: identity, follows, delivery,
replies and likes. It lacks the card. A workout posted to Mastodon today is a
sentence and a screenshot; a federated fitness server posting to another
federated fitness server has no agreed shape for the stats behind it, so each
pair of implementations negotiates its own.

Two things are missing:

- a shared shape for "a measured thing over a time window", and
- a realistic answer to the fact that **extension vocabularies do not survive
  federation** through mainstream servers, which parse inbound objects into a
  fixed vocabulary and drop unknown terms.

QuantPub therefore treats the in-band vocabulary as progressive enhancement and
standardises the out-of-band fetch: deliver a boring, Mastodon-compatible
`Note` (text plus rendered-image attachments) and serve the machine-readable
payload at a discoverable endpoint on the author's own instance. A peer that
recognises the pattern fetches the structured data and renders the card;
everyone else sees a perfectly good status.

The same shape covers sleep, HRV, steps and mood, so the proposal is written
for quantified-self data in general, with exercise as the leading case. And
because the payload side needs no ActivityPub stack, the many hand-rolled
single-user QS systems — a database, some sync scripts, a dashboard — can join
with a handful of routes.

## Requirements

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be
interpreted as described in [RFC-2119].

## Specification

### 1. Conformance levels and conventions

- **Level 1 — Data publisher.** Serves the discovery document (§4) and the
  structured post endpoint (§5), optionally the series endpoint (§6). No
  ActivityPub required.
- **Level 2 — Federated publisher.** Level 1, plus an ActivityPub actor that
  delivers `Note`-compatible objects (§2, §3) whose payloads are resolvable via
  §7.
- **Level 3 — Federated peer.** Level 2, plus inbound: following others,
  detecting QuantPub-capable origins and enriching received posts (§7).

All names are lowerCamelCase, on the JSON-LD layer and the plain-JSON payload
layer alike, so a post's `startTime` and its payload's `startTime` are the same
name. AS2 properties are reused where they exist (`startTime`, `endTime`,
`name`). Timestamps are ISO 8601 with timezone; time _inside_ an activity is
an integer second offset from its start (§2.3). Units are [UCUM] codes
(§2.1). The `quant:` namespace is `https://w3id.org/quantpub#` (final IRI to
be settled with the FEP number).

`quant:metrics` and `quant:series` are **JSON literals**: the published
`@context` defines both with `"@type": "@json"` (JSON-LD 1.1), so processors
preserve the nested objects verbatim instead of expanding, and losing,
unmapped keys. Consumers MUST treat these values as plain JSON; a series
entry's `mediaType`/`href` are data, not an AS2 `Link`.

### 2. `quant:Exercise` — a shared workout

A shared exercise is an AS2 object, RECOMMENDED to be **dual-typed**
`["Note", "quant:Exercise"]` — `Note` first, so plain clients render
`name`/`content` as a status. The extra type is descriptive, not load-bearing:
detection (§7) keys on the object id or `quant:structuredUrl`, never on the
type, so a publisher MAY emit a single-typed `Note` where deployed consumers
mishandle array-valued `type` (§10). Consumers MUST tolerate both forms.

| Property                | Type                    | Notes                                                                   |
| ----------------------- | ----------------------- | ----------------------------------------------------------------------- |
| `startTime` (AS2)       | ISO 8601                | REQUIRED. Start of the bounded activity window (§2.3)                   |
| `endTime` (AS2)         | ISO 8601                | RECOMMENDED. End of the window; omitted under `"day"` precision (§2.3)  |
| `quant:timePrecision`   | `"second"` \| `"day"`   | OPTIONAL, default `"second"` (§2.3)                                     |
| `quant:activityType`    | string                  | A FIT `sport` key, e.g. `running`, `cycling`, `alpine_skiing` (§2.4)    |
| `quant:activitySubtype` | string                  | OPTIONAL. A FIT `sub_sport` key or `prefix:name` (§2.4)                 |
| `quant:source`          | object                  | OPTIONAL `{ "device", "via" }` attribution (§2.5)                       |
| `quant:metrics`         | array of metric objects | REQUIRED at Level 2+. The shared scalar summaries (§2.1); empty if none |
| `quant:series`          | array of series links   | Links into §6 — only for series opted in on a **publicly-visible** post |
| `quant:structuredUrl`   | URL                     | OPTIONAL explicit link to the object's §5 payload (§7)                  |

There is no duration property: duration is derivable from the window, and when
shared as a stat it is the `duration` metric key (`s`). AS2 `duration` MAY be
set additionally for plain-AS2 consumers.

`published` is the _share_ time and orders the timeline; the workout time lives
in `startTime`. A workout shared a week later MUST NOT be back-dated in
followers' timelines.

#### 2.1 Metric objects

```json
{ "key": "heartRateAvg", "value": 152 }
```

- `key` (REQUIRED): a RECOMMENDED bare key from the table below, or an
  extension key of the form `prefix:name` (§2.2). A scalar key names an
  aggregate (`heartRateAvg`); the series it summarises is named by the raw
  metric (`heartRate`, §6).
- `value` (REQUIRED): a number, or a small keyed record of numbers (e.g.
  HR-zone minutes `{ "z2": 22, "z3": 10 }`).
- `unit`: a [UCUM] code. For a RECOMMENDED key `unit` MUST be omitted or equal
  to the canonical unit; a publisher holding the value in another unit
  converts before emitting. For an extension key `unit` is REQUIRED; a count
  or a score is `1`, optionally with a UCUM annotation such as `{TEP}`.
- `label` (OPTIONAL): a human-readable name for the key (§2.2).

Every RECOMMENDED key has one canonical unit, so readers never guess:

| Key                            | Unit   | Notes                                              |
| ------------------------------ | ------ | -------------------------------------------------- |
| `duration`                     | `s`    | Consumers SHOULD render as a duration              |
| `distance`                     | `m`    |                                                    |
| `elevationGain`                | `m`    |                                                    |
| `heartRateAvg`, `heartRateMax` | `/min` |                                                    |
| `hrZoneMinutes`                | `min`  | Record of zone → minutes, `{ "z2": 22, "z3": 10 }` |
| `calories`                     | `kcal` |                                                    |
| `speedAvg`                     | `m/s`  | Replaces 0.2's `paceAvg`                           |
| `steps`                        | `1`    | Count                                              |
| `stressAvg`                    | `1`    | Implementation scale                               |
| `sleepDuration`                | `s`    | Observation keys (§3)                              |
| `sleepScore`, `mood`           | `1`    | Implementation scale                               |
| `hrvAvg`                       | `ms`   |                                                    |

A series `unit` (§6.1) follows the same rule; a `heartRate` series is `/min`.

A publisher MUST emit only the metrics the author explicitly chose to share;
absence is "not shared", never "zero" (§8.1).

#### 2.2 Extension keys

A metric or series key is either a RECOMMENDED bare key (§2.1) or
`prefix:name`. `quant:metrics` is a JSON literal (§1), so JSON-LD does not
expand keys inside it and this document has to say what a prefix means. The
prefix resolves to an IRI: at Level 2+ through the object's JSON-LD `@context`
(the mechanism `quant:` itself uses), at Level 1 through the OPTIONAL
`prefixes` map in the discovery document (§4). The resolved IRI
(`vertmatch:tep` → `https://vertmatch.run/ns#tep`) is the key's documentation
link.

```json
{ "key": "vertmatch:tep", "value": 180, "unit": "1", "label": "TEP" }
```

Receivers MAY render an unknown key as `label` plus `value`, MUST NOT guess
its unit, and MUST NOT treat a prefixed key as any RECOMMENDED key even if the
local name matches.

#### 2.3 Time precision and the activity clock

`quant:timePrecision` (OPTIONAL) is `"second"` (default) or `"day"`.
`startTime` stays an AS2 `xsd:dateTime` in both cases: a bare date where AS2
declares a dateTime breaks typed consumers, the kind of breakage §10 exists to
avoid. Under `"day"`, `startTime` carries the local midnight with timezone
offset, `endTime` is omitted, and receivers MUST NOT render a time of day.
Receivers MUST show the date in the offset `startTime` carries, never
converted to the viewer's zone: a run sent as `2026-09-20T00:00:00+02:00` is
20 September everywhere.

All time _inside_ an activity — series samples (§6.1), route points and
segments (§5) — is an integer `offset` in seconds since the activity's
**true** start. Offsets count from the true start, never from a
`"day"`-precision midnight placeholder. A consumer with a precise `startTime`
reconstructs absolute times by addition; one without still gets the chart.
Day precision therefore does not exclude series (§8.8).

#### 2.4 Activity type and subtype

`quant:activityType` is a [FIT] profile `sport` key (`running`, `cycling`,
`alpine_skiing`, …). `quant:activitySubtype` (OPTIONAL) is a FIT `sub_sport`
key (`trail`, `gravel_cycling`, `backcountry`, …) or, where FIT has no key, a
`prefix:name` extension resolved as in §2.2 (e.g. `alpine_skiing` +
`vertmatch:skimo`). A reader that does not know the subtype falls back to the
type. The FIT lists are referenced, not copied: they are open, and FIT is the
one vocabulary with both a hierarchy and an installed base.

#### 2.5 Source attribution

```json
{ "device": "Garmin Forerunner 965", "via": "Intervals.icu" }
```

`quant:source` (OPTIONAL) carries two free-text strings, `device` and `via`;
either MAY be absent. Device makers' and services' terms often require naming
them wherever the data is shown; receivers SHOULD show `source` next to the
workout.

### 3. `quant:Observation` — a measured metric over a window

Exercise is one case of the general shape: _something was measured over a
bounded window_. A `quant:Observation` covers sleep, HRV, steps, mood, weight,
blood glucose — anything with a window and values. It is dual-typed
`["Note", "quant:Observation"]` (RECOMMENDED, same single-type allowance as
§2) and carries the §2 properties with `quant:activityType` and
`quant:activitySubtype` replaced by:

| Property              | Type   | Notes                                              |
| --------------------- | ------ | -------------------------------------------------- |
| `quant:observationOf` | string | The domain observed, e.g. `sleep`, `daily`, `mood` |

`quant:metrics` carries the observed values in the §2.1 shape (`sleepDuration`,
`sleepScore`, `hrvAvg`, `steps`, `mood`, …). Implementations MAY treat
`quant:Exercise` as a specialisation of `quant:Observation`.

### 4. Discovery: `/.well-known/quantpub`

An implementation MUST serve, at its web base URL:

```
GET /.well-known/quantpub
```

```json
{
  "product": "my-qs-tool",
  "version": "1.0.0",
  "quantpub": "0.3",
  "apiBase": "https://qs.example.net/api",
  "prefixes": { "vertmatch": "https://vertmatch.run/ns#" }
}
```

- `product` / `version`: free-form implementation identity.
- `quantpub`: the spec version implemented. `0.3` is this document. Earlier
  versions differed: `0.1` used snake_case payload field names and metric keys
  (`api_base`, `start_time`, `heart_rate_avg`); `0.2` used camelCase names
  with absolute-timestamped samples, a window-addressed series endpoint and
  free-form units; `0.3` has relative offsets, the per-post series endpoint
  and canonical units. Consumers MAY accept earlier versions, and MUST
  interpret a metric without `unit` by the sender's version: `0.2` distance
  without a unit was km, `0.3` is m.
- `apiBase`: the absolute base URL under which the §5/§6 endpoints live.
- `prefixes` (OPTIONAL): extension-key prefixes mapped to IRIs (§2.2), the
  Level 1 counterpart of a JSON-LD `@context`.

One cacheable request (responses SHOULD carry e.g. `max-age=3600`) tells a
peer whether a host speaks QuantPub and where its API is. NodeInfo is
deliberately not reused: this document gates a fetch decision made on every
ingest, so it must be tiny and unambiguous.

### 5. Structured post endpoint

For every shared post the origin MUST serve a machine-readable payload at:

```
GET {apiBase}/public/{username}/feed/{postId}
```

returning a JSON object discriminated on `kind`. An exercise or observation
share is `kind: "activity"`:

```json
{
  "kind": "activity",
  "activityType": "running",
  "activitySubtype": "trail",
  "name": "Morning run",
  "startTime": "2026-08-15T06:30:00+02:00",
  "endTime": "2026-08-15T07:09:00+02:00",
  "source": { "device": "Garmin Forerunner 965", "via": "Intervals.icu" },
  "metrics": [
    { "key": "duration", "value": 2340 },
    { "key": "distance", "value": 8200 },
    { "key": "heartRateAvg", "value": 152 },
    { "key": "hrZoneMinutes", "value": { "z2": 22, "z3": 10 } },
    { "key": "vertmatch:tep", "value": 180, "unit": "1", "label": "TEP" }
  ],
  "series": [
    {
      "metric": "heartRate",
      "unit": "/min",
      "bucket": "5s",
      "samples": [
        { "offset": 0, "avg": 121, "min": 118, "max": 124, "count": 5 }
      ]
    }
  ],
  "segments": [
    {
      "kind": "climb",
      "name": "Rumer Alm",
      "id": "https://example.app/climbs/123",
      "startOffset": 1140,
      "endOffset": 3840,
      "startDistance": 3200,
      "endDistance": 7800,
      "metrics": [
        { "key": "elevationGain", "value": 640 },
        { "key": "duration", "value": 2700 }
      ]
    }
  ],
  "route": [{ "lat": 59.3251, "lon": 18.071, "offset": 0 }]
}
```

- `activityType` and `activitySubtype` (exercise) or `observationOf`
  (observation), `name`, `startTime`, `endTime`, `timePrecision` and `source`
  mirror the object's properties (§2).
- `metrics` MUST contain exactly the shared scalars — the same array as the
  delivered `Note`'s `quant:metrics`, so a receiver can render the card from
  the object alone and fetch the payload only for series, segments and route.
- `series` MUST contain only series the author _separately_ opted in (§8.3),
  as bucketed samples (§6.1) on the activity clock (§2.3). It MAY be empty.
- `segments` (OPTIONAL): parts of the activity — climbs, descents, laps,
  intervals. Each carries `kind` (free text), OPTIONAL `name`, OPTIONAL `id`
  (an IRI), OPTIONAL `startOffset` and `endOffset` (seconds on the activity
  clock, as for series), OPTIONAL `startDistance` and `endDistance` (`m`), and
  `metrics` in the §2.1 shape with the same unit rules. A segment carries at
  least one of the two pairs, so an untimed climb can be given by distance
  alone. Like metrics, segments are
  emitted only when the author chose to share them; a segment with a public
  `id` locates the activity, and a sharing UI SHOULD say so.
- `route` (OPTIONAL) is the GPS track as an ordered array of
  `{ "lat", "lon", "offset" }` (WGS84; `offset` on the activity clock),
  present only when the author chose to share the route (§8.7). `offset` is
  OPTIONAL (§8.7); without it points are `{ "lat", "lon" }`. Offset points
  are used instead of a GeoJSON
  `LineString` because the time is what lets a consumer sync the route to the
  series chart. It also exposes position-at-time, hence pace; a client
  offering route sharing SHOULD say so.
- Implementations MAY define further `kind`s. Consumers MUST ignore unknown
  kinds.

Authorization follows post visibility: a public or unlisted post resolves
unconditionally; a followers-only post resolves only with a valid capability
token or signed follower fetch (§9); anything else, a nonexistent post
included, returns 404 (§8.4).

### 6. Series endpoint

High-resolution series MUST NOT be embedded in federated objects. They are
served per post from one public, read-only endpoint:

```
GET {apiBase}/public/{username}/feed/{postId}/series/{metric}?bucket={size}
```

`bucket` is an integer followed by `s`, `m`, `h` or `d` (`5s`, `60s`, `1d`).

A request resolves **only when both of the following hold**; this data-driven
check is the entire authorization boundary:

1. the post is publicly visible;
2. the author opted that exact `metric` in as a **series** on that post (a
   shared scalar summary alone MUST NOT satisfy this).

Anything else — a nonexistent post or metric included — returns 404 (§8.4).
Samples are aggregated buckets (§6.1). A publisher SHOULD floor the bucket
size server-side, 5 seconds being the RECOMMENDED floor; the resolution it
serves is its own choice (§8.6).

#### 6.1 Bucketed samples

```json
{
  "metric": "heartRate",
  "unit": "/min",
  "bucket": "5s",
  "samples": [{ "offset": 0, "avg": 121, "min": 118, "max": 124, "count": 5 }]
}
```

Each sample carries `offset` (seconds since the activity's true start, §2.3),
`avg`, `min`, `max`, `count`, and `sum` for cumulative metrics such as steps;
a sample's width is the series-level `bucket`. `unit` follows §2.1. One shape
serves heart-rate traces, nightly HRV, daily step counts and mood check-ins
alike; only the metric key and bucket size differ.

### 7. Detection and enrichment (Level 3)

A consumer needs a defined path from a received object to its §5 payload. The
id convention is the baseline, since typed AS2 frameworks on the consuming side
may drop unknown in-band properties before application code sees them:

- **Object-id convention.** A Level 2 publisher SHOULD mint post object ids as
  `{webBase}/users/{username}/feed/{postId}`. A consumer that matches this
  shape resolves the payload at `{apiBase}/public/{username}/feed/{postId}`,
  with `{apiBase}` from the origin's discovery document (§4).
- **`quant:structuredUrl` (in-band override).** A publisher whose URL layout
  differs MAY state the payload URL on the object. A consumer MUST honour it
  only when its host equals the object id's host — never fetch a cross-origin
  URL a remote object nominates.

On ingesting a `Create`/`Update` for a `Note`, a receiving peer:

1. checks for a same-host `quant:structuredUrl` or an id matching the
   convention (a Mastodon status id never does, avoiding needless requests);
2. resolves the payload URL — directly from `quant:structuredUrl`, or from the
   id convention plus `{apiBase}` from the cached discovery document. In the
   `quant:structuredUrl` case a consumer MAY fetch the discovery document as a
   capability check but MUST NOT require it;
3. fetches the §5 payload and stores it alongside the sanitised note for native
   rendering.

Enrichment MUST be best-effort and additive: any failure (non-QuantPub host,
404, malformed payload, timeout) leaves the plain note intact. Fetches MUST be
SSRF-guarded (see Security considerations).

### 8. Privacy model (normative)

1. **Every element of a share is the author's choice.** A publisher MUST emit
   only the metrics, series, segments and route the author chose to share.
   Absence means "not shared", never "zero". A platform MAY set any element's
   default on or off, open-by-design included, provided the default is clear
   to the author; the defaults below are RECOMMENDED, not required.
2. **Scalars never imply series.** Sharing `heartRateAvg` MUST NOT expose the
   heart-rate series. A per-sample trace is far more revealing than an average.
3. **Series are a separate choice**, per post, per metric. RECOMMENDED
   default: no series.
4. **Unshared equals nonexistent.** Requests for unshared data MUST return
   404, never 403, so the response cannot reveal that unshared data exists.
5. **Revocation is immediate and reaches stored copies.** Deleting a post,
   narrowing its visibility, or withdrawing a series opt-in MUST immediately
   stop the corresponding endpoints from resolving. **All** §5 and §6
   responses — public and unlisted included — MUST be served
   `Cache-Control: no-store`, so no intermediary extends access beyond
   revocation. Only the discovery document (§4) is cacheable. A peer that
   stored a payload (§7) MUST drop it on `Delete`, and on `Update` MUST
   refetch the payload and drop it if the fetch returns 404.
6. **Resolution is the publisher's choice.** The series bucket floor (§6)
   and any route downsampling are RECOMMENDED bounds, not requirements: a
   platform that is open by design MAY serve full resolution, and route
   matching and segments need it. The resolution a publisher serves SHOULD be
   clear to its authors.
7. **Geography is its own choice.** A route MUST NOT be exposed by any
   scalar or series share (item 1); RECOMMENDED default: no route. Route
   points MAY carry `offset`; offsets expose pace, so a publisher SHOULD
   present a timed route as a choice distinct from the route's shape, or
   include offsets only when a series is also shared. Publishers SHOULD offer
   privacy geo-masking (home-zone trimming), applied before export and not
   only in rendering. The payload MUST NOT indicate whether or how much a
   route was masked.
8. **Day precision hides the time of day.** A `"day"`-precision post (§2.3)
   does not exclude series, since offsets are relative, but it MUST NOT carry
   anything that reveals the time of day: no `endTime`, and no timestamp
   finer than the date anywhere in the object or payload.

### 9. Capability tokens for follower-scoped payloads

Mainstream fediverse media and data fetches are **unsigned**: Mastodon's
"authorized fetch" signs ActivityPub object requests, not media downloads, and
a Level 1 publisher has no actor keys at all. QuantPub therefore uses
**capability URLs** as the baseline for followers-only posts.

- Each followers-only post carries an unguessable token, generated with a
  cryptographically secure RNG. Its payload and image URLs include
  `?token={token}` **only in the copies delivered to accepted followers**;
  the token never appears on any public surface.
- The token MUST reach the consumer through a channel that survives typed
  processing, since the §7 id convention alone yields a tokenless URL and an
  extension property may be dropped. Two channels are defined: (a) the
  delivered **image attachment URLs** (`?token=` on each `attachment` `Image`
  `url`), which standard AS2 processing preserves — REQUIRED whenever the post
  has image attachments; (b) `quant:structuredUrl` carrying the token, the
  only channel for an attachment-less post. A publisher SHOULD attach at least
  one tokenised image wherever the post has any renderable image.
- Consumers SHOULD lift the token from a delivered attachment URL, falling
  back to a same-host `quant:structuredUrl`, and forward it to the payload
  fetch.
- A matching token resolves the payload; anything else is 404 (§8.4).
- Tokens MUST be revocable — regenerated or invalidated when the post is
  deleted or its visibility changes — so that with `no-store` (§8.5)
  revocation is immediate.
- A publisher MAY rotate a followers-only post's token at any time and SHOULD
  do so when it blocks an actor or widens what the post shares (an `Update`
  adding a series, say); it then delivers an `Update` to the post's current
  audience so they receive the new token. Rotation stops fetches that have not
  yet happened; a copy a peer already stored is governed by §8.5. Unfollowing
  by itself calls for no rotation: as with any delivered object, the former
  follower already holds what was delivered, and ActivityPub does not recall
  it.
- A leaked capability URL grants access to that one post's shared payload,
  never to the public series endpoint, which serves publicly-visible shares
  only.

**Signed fetches as an additional grant.** Purpose-built peers can sign their
fetches (FitPub authorizes followers-only details this way). A Level 2+
publisher MAY additionally resolve a followers-only §5 payload for a request
bearing a valid [HTTP Signature] from an accepted follower or its instance
actor, and a Level 3 consumer SHOULD sign its enrichment fetches when it has an
actor key. Signatures are strictly additive: they MUST NOT replace capability
tokens, the only channel that works without ActivityPub keys on either side,
and a request satisfying neither channel is still 404.

### 10. Coexistence and incremental adoption

Every part of this proposal is additive, so an implementation with an
established federation format can adopt it without breaking federation with
its own older versions:

- The discovery document and the §5/§6 endpoints are **new routes**; an
  existing vendor detail endpoint keeps serving unchanged alongside them.
- The `quant:*` properties ride alongside any existing vendor extension on the
  same `Note` (e.g. FitPub's `fitpub:detailUri`); old peers ignore what they
  don't know and see the object they saw before.
- Dual-typing is RECOMMENDED but not required (§2): array-valued `type` is
  well-formed AS2 but the one addition known to break some deployed
  consumers. A publisher whose install base predates array-type tolerance
  SHOULD start single-typed and add the second type later.
- The object id need not change: a publisher keeping its id layout uses
  `quant:structuredUrl` (§7).

## Implementing this in a weekend

A home-built QS tool becomes a **Level 1 publisher** with two-and-a-half
routes and no ActivityPub stack:

1. Serve `/.well-known/quantpub` (static JSON, §4).
2. Serve `GET /public/{you}/feed/{postId}` for each thing you choose to
   publish (§5) — near-static JSON for a single-user tool.
3. Optionally serve `GET /public/{you}/feed/{postId}/series/{metric}` (§6)
   for the series you explicitly share, with the two-condition check and 404
   fallback.

Any Level 3 peer that learns one of your post URLs can now render your data
natively. Adding a minimal ActivityPub actor later (WebFinger, inbox/outbox,
`Create{Note}` delivery — Level 2) makes you followable from Mastodon and every
QuantPub peer, with the structured channel already in place.

## Examples

### A federated exercise share (`Create`)

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    {
      "quant": "https://w3id.org/quantpub#",
      "quant:metrics": { "@type": "@json" },
      "quant:series": { "@type": "@json" },
      "vertmatch": "https://vertmatch.run/ns#"
    }
  ],
  "id": "https://qs.example.net/users/freja/feed/01J5X0#create",
  "type": "Create",
  "actor": "https://qs.example.net/users/freja",
  "published": "2026-08-15T08:02:11+02:00",
  "to": ["https://www.w3.org/ns/activitystreams#Public"],
  "cc": ["https://qs.example.net/users/freja/followers"],
  "object": {
    "id": "https://qs.example.net/users/freja/feed/01J5X0",
    "type": ["Note", "quant:Exercise"],
    "attributedTo": "https://qs.example.net/users/freja",
    "name": "Morning run",
    "content": "<p><strong>Morning run</strong></p><p>Duration 39m · Distance 8.2 km · Heart rate avg 152 bpm · HR zones z2 22, z3 10 · TEP 180</p>",
    "published": "2026-08-15T08:02:11+02:00",
    "startTime": "2026-08-15T06:30:00+02:00",
    "endTime": "2026-08-15T07:09:00+02:00",
    "quant:activityType": "running",
    "quant:activitySubtype": "trail",
    "quant:source": {
      "device": "Garmin Forerunner 965",
      "via": "Intervals.icu"
    },
    "quant:structuredUrl": "https://qs.example.net/api/public/freja/feed/01J5X0",
    "quant:metrics": [
      { "key": "duration", "value": 2340 },
      { "key": "distance", "value": 8200 },
      { "key": "heartRateAvg", "value": 152 },
      { "key": "hrZoneMinutes", "value": { "z2": 22, "z3": 10 } },
      { "key": "vertmatch:tep", "value": 180, "unit": "1", "label": "TEP" }
    ],
    "quant:series": [
      {
        "metric": "heartRate",
        "mediaType": "application/json",
        "href": "https://qs.example.net/api/public/freja/feed/01J5X0/series/heartRate?bucket=5s"
      }
    ]
  }
}
```

Mastodon renders `content` and any attached chart image; a QuantPub peer
recognises the id shape (or the same-host `quant:structuredUrl`), discovers the
origin and fetches the §5 payload. The inline `"@type": "@json"` definitions
mirror the published `@context`; once the final context IRI is settled,
referencing it alone suffices. The `vertmatch` prefix in the `@context` is
what resolves the `vertmatch:tep` key (§2.2).

### A sleep observation (object only)

```json
{
  "type": ["Note", "quant:Observation"],
  "name": "Last night's sleep",
  "content": "<p><strong>Last night's sleep</strong></p><p>Sleep 7h 40m · HRV avg 64 ms · Score 86</p>",
  "quant:observationOf": "sleep",
  "startTime": "2026-08-14T23:05:00+02:00",
  "endTime": "2026-08-15T06:45:00+02:00",
  "quant:metrics": [
    { "key": "sleepDuration", "value": 27600 },
    { "key": "hrvAvg", "value": 64 },
    { "key": "sleepScore", "value": 86 }
  ]
}
```

### A day-precision share (object only)

```json
{
  "type": ["Note", "quant:Exercise"],
  "name": "Long run",
  "startTime": "2026-09-20T00:00:00+02:00",
  "quant:timePrecision": "day",
  "quant:activityType": "running",
  "quant:metrics": [
    { "key": "distance", "value": 24300 },
    { "key": "duration", "value": 8100 }
  ]
}
```

No `endTime`, and a receiver shows the date only. Any series on this post
still uses offsets from the run's true start (§2.3).

### Series requests and the 404 boundary

```
GET /api/public/freja/feed/01J5X0/series/heartRate?bucket=60s
→ 200, bucketed samples (heartRate opted in as a series on a public post)

GET /api/public/freja/feed/01J5X0/series/stress?bucket=60s
→ 404 (stressAvg scalar was shared, but the stress series was not opted in)

GET /api/public/freja/feed/01J5X1/series/heartRate?bucket=60s
→ 404 (followers-only post: the series endpoint serves public shares only)
```

## Security considerations

- **Enrichment fetches are server-side requests to remote-controlled URLs.**
  Level 3 peers MUST SSRF-guard them: public addresses only, no redirects,
  bounded response size and time, and SHOULD restrict the origin to the
  followee's own host.
- **Remote content is untrusted.** Received `content` HTML MUST be sanitised
  server-side; structured payloads MUST be schema-validated, and malformed
  payloads discarded (leaving the plain note).
- **Capability URLs can leak** (referrers, logs, pasted exports). Their blast
  radius is one post's shared payload; implementations SHOULD refuse to embed
  follower-scoped tokens in publicly-pasteable exports.
- **The 404 discipline is load-bearing.** Any distinguishable response for
  "exists but unshared" (403, timing, body) becomes a probe oracle for what
  data a user has.
- **Aggregation is not anonymisation.** Bucketed series still reveal patterns
  (sleep schedules, home departure times via workout starts). The per-metric,
  per-post opt-in exists so authors make this choice deliberately; clients
  SHOULD present series sharing as distinct from summary sharing.
- **Routes are the most identifying payload.** A track typically starts or
  ends at home; hence the separate choice and the geo-masking recommendation
  (§8.7). An open-by-design platform SHOULD make that clear to its authors.

## Prior art

- **[FitPub](https://fitpub.social/)** — federated fitness tracking whose wire
  format is this proposal's closest relative: a plain `Note` (HTML summary,
  map-image attachment) with AS2 `startTime`/`endTime` and an in-band pointer
  `fitpub: { "detailUri": … }` to an out-of-band detail endpoint — the same
  Note-plus-pointer architecture as §2/§5. It differs in the parts this
  proposal standardises: the detail payload is its internal API DTO rather
  than a vendor-neutral contract; detection is by property presence plus
  NodeInfo rather than a capability document; followers-only details are
  authorized by signed `GET`s (adopted as the optional §9 grant) rather than
  capability tokens; non-public objects answer `403` rather than `404`; and it
  has no series concept. §10 describes how such an implementation adopts
  QuantPub without breaking federation with its own older versions.
- **[Open Pace](https://github.com/edance/openpace)** — federated running
  publishing; single-domain and product-shaped rather than a vocabulary for
  arbitrary metrics.
- **[Endurain](https://github.com/joaovitoriasilva/endurain)** and
  **[Wanderer](https://github.com/Flomp/wanderer)** — self-hosted fitness and
  trail platforms with federation interest; natural candidate implementers.
- **[FEP-67ff]** (FEDERATION.md) — a QuantPub implementation SHOULD document
  its supported metric keys and endpoints there.
- **[FEP-400e]** — publicly appendable collections. Not used here, but the
  natural building block for a future challenges proposal (cross-instance
  competitions over §6 series), which is out of scope for this document.
- Mastodon's handling of unknown types and properties — the observed
  behaviour that motivates the `Note`-first dual-typing and the out-of-band
  channel.

## Implementations

- **[Aurboda](https://github.com/fiddur/aurboda)** — full stack: vocabulary
  on the wire, discovery document, published context at `/ns/quantpub`,
  structured post and series endpoints, capability tokens on attachment URLs,
  and Level 3 enrichment via the §7 id convention. Serves `0.2`, accepts
  `0.1`; `0.3` in progress.
- **[VertMatch](https://vertmatch.run)** — trail-running and training
  platform: discovery document, structured activity shares, Level 3 reading
  via `quant:structuredUrl` and the id convention; also follows FitPub actors.
  Serves `0.1`, moving to `0.2`; `0.3` intended.

## References

- [ActivityPub] — Christine Lemmer-Webber, Jessica Tallon, Erin Shepherd, Amy
  Guy, Evan Prodromou, _ActivityPub_, 2018
- [RFC-2119] — S. Bradner, _Key words for use in RFCs to Indicate Requirement
  Levels_, 1997
- [HTTP Signature] — A. Backman, J. Richer, M. Sporny, _Signing HTTP
  Messages_ (draft-cavage-http-signatures), 2019
- [UCUM] — G. Schadow, C. J. McDonald, _The Unified Code for Units of
  Measure_
- [FIT] — Garmin, _FIT SDK_ (profile `sport` and `sub_sport` types)
- [FEP-67ff] — silverpill, _FEDERATION.md_, 2023
- [FEP-400e] — Gregory Klyushnikov, _Publicly-appendable ActivityPub
  collections_, 2021

## Copyright

CC0 1.0 Universal (CC0 1.0) Public Domain Dedication.

To the extent possible under law, the authors of this Fediverse Enhancement
Proposal have waived all copyright and related or neighboring rights to this
work.

[ActivityPub]: https://www.w3.org/TR/activitypub/
[HTTP Signature]: https://datatracker.ietf.org/doc/html/draft-cavage-http-signatures
[RFC-2119]: https://datatracker.ietf.org/doc/html/rfc2119
[UCUM]: https://ucum.org/
[FIT]: https://developer.garmin.com/fit/
[FEP-67ff]: https://codeberg.org/fediverse/fep/src/branch/main/fep/67ff/fep-67ff.md
[FEP-400e]: https://codeberg.org/fediverse/fep/src/branch/main/fep/400e/fep-400e.md
