---
slug: 'xxxx'
authors: Fredrik Liljegren
status: DRAFT
dateReceived: (not yet submitted)
---

# FEP-xxxx: QuantPub — federated personal metrics for quantified-self sharing

> **Status of this document.** A pre-submission draft, developed in the open in
> the [Aurboda](https://github.com/fiddur/aurboda) repository (issue
> [#905](https://github.com/fiddur/aurboda/issues/905)) for discussion on
> r/QuantifiedSelf and SocialHub before submission to the
> [FEP process](https://codeberg.org/fediverse/fep). The FEP number is a
> placeholder.

> **Naming.** The working name is **QuantPub**, prefix `quant:`. The name is
> open for community input; alternatives include **Personal Metrics
> Vocabulary** and **MetricPub**.

## Summary

QuantPub is a small, vendor-neutral extension to [ActivityPub] for sharing
personal quantified-self data — workouts, sleep, heart-rate variability, steps,
mood — between federated instances **and** home-built personal tools, without
giving up mainstream-fediverse compatibility or the author's control over what
leaves their instance.

It has three parts:

1. A tiny **vocabulary** (`quant:Exercise`, `quant:Observation`) that attaches
   typed scalar summaries and a bounded time window to an ordinary AS2 `Note`,
   so Mastodon-class servers render a readable status while implementing peers
   read machine-readable data.
2. An **out-of-band structured-payload pattern** — a well-known discovery
   document plus two public HTTP endpoints — because typed vocabulary
   extensions are, in practice, dropped by mainstream fediverse software. This
   channel is the interoperable core of the proposal.
3. **Privacy principles as normative requirements**: scalar summaries never
   imply series access, series and geography are separate explicit opt-ins,
   authorization is data-driven (unshared data is indistinguishable from
   nonexistent data), and revocation is immediate.

A home-built QS tool interoperates by implementing the discovery document and
the two endpoint contracts — no ActivityPub actor required — and can grow into
full federation later.

## Motivation

The quantified-self community is full of hand-rolled, single-user systems: a
database, some sync scripts, a dashboard. They will never converge on one
product, but they _could_ converge on a small wire contract — and then their
owners could follow each other, see each other's data rendered natively, and
run cross-instance comparisons, as single-vendor fitness platforms do behind
walled gardens today.

ActivityPub already solves identity, discovery, follow relationships and
delivery. What is missing is:

- a shared shape for "a measured thing over a time window", and
- a realistic answer to the fact that **extension vocabularies do not survive
  federation** through mainstream servers, which parse inbound objects into a
  fixed vocabulary and drop unknown terms.

QuantPub therefore treats the in-band vocabulary as _progressive enhancement_
and standardises the out-of-band fetch: deliver a boring, Mastodon-compatible
`Note` (flattened text plus rendered-image attachments) and serve the
machine-readable payload at a discoverable endpoint on the author's own
instance. A peer that recognises the pattern fetches the structured data;
everyone else sees a perfectly good status.

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
`name`) rather than minting parallel terms. Timestamps are ISO 8601 with
timezone. The `quant:` namespace is `https://w3id.org/quantpub#` (final IRI to
be settled with the FEP number).

`quant:metrics` and `quant:series` are **JSON literals**: the published
`@context` defines both with `"@type": "@json"` (JSON-LD 1.1), so conforming
processors preserve the nested objects verbatim instead of expanding, and
losing, unmapped keys. A series entry's `mediaType`/`href` are therefore opaque
to JSON-LD processing — plain data, not an AS2 `Link`. Consumers MUST treat
these values as plain JSON.

### 2. `quant:Exercise` — a shared workout

A shared exercise is an AS2 object, RECOMMENDED to be **dual-typed**
`["Note", "quant:Exercise"]` — `Note` first, so plain clients render
`name`/`content` as a status. The extra type is descriptive, not load-bearing:
detection (§7) keys on the object id or `quant:structuredUrl`, never on the
type, so a publisher MAY emit a single-typed `Note` where deployed consumers
mishandle array-valued `type` (see §10). Consumers MUST tolerate both forms.

| Property              | Type                    | Notes                                                                   |
| --------------------- | ----------------------- | ----------------------------------------------------------------------- |
| `startTime` (AS2)     | ISO 8601                | REQUIRED. Start of the bounded activity window                          |
| `endTime` (AS2)       | ISO 8601                | RECOMMENDED. End of the window                                          |
| `quant:activityType`  | string                  | e.g. `running`, `cycling`, `meditation`                                 |
| `quant:metrics`       | array of metric objects | The scalar summaries the author chose to share (§2.1)                   |
| `quant:series`        | array of series links   | Links into §6 — only for series opted in on a **publicly-visible** post |
| `quant:structuredUrl` | URL                     | OPTIONAL explicit link to the object's §5 payload (§7)                  |

There is no duration property: duration is derivable from the window, and when
shared as a stat it is the `duration` metric key (seconds). AS2 `duration` MAY
be set additionally for plain-AS2 consumers.

`published` is the _share_ time and orders the timeline; the workout time lives
in `startTime`. A workout shared a week later MUST NOT be back-dated in
followers' timelines.

#### 2.1 Metric objects

```json
{ "key": "heartRateAvg", "value": 152, "unit": "bpm" }
```

- `key` (REQUIRED): a lowerCamelCase machine key. RECOMMENDED common keys:
  `duration`, `distance`, `heartRateAvg`, `heartRateMax`, `hrZoneMinutes`,
  `calories`, `steps`, `elevationGain`, `paceAvg`, `stressAvg`.
  Implementations MAY add their own. A scalar key names an aggregate
  (`heartRateAvg`); the series it summarises is named by the raw metric
  (`heartRate`, §6).
- `value` (REQUIRED): a number, or a small keyed record of numbers (e.g.
  HR-zone minutes `{ "z2": 22, "z3": 10 }`).
- `unit` (OPTIONAL): a unit string for the scalar form (`bpm`, `km`,
  `seconds`, `kcal`). Consumers SHOULD render `seconds` as a duration.

A publisher MUST emit only the metrics the author explicitly chose to share.
Absence of a key means "not shared", never "zero".

### 3. `quant:Observation` — a measured metric over a window

Exercise is one case of the general shape: _something was measured over a
bounded window_. A `quant:Observation` covers sleep, HRV, steps, mood, weight,
blood glucose — anything with a window and values. It is dual-typed
`["Note", "quant:Observation"]` (RECOMMENDED, same single-type allowance as
§2) and carries the §2 properties with `quant:activityType` replaced by:

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
  "quantpub": "0.1",
  "apiBase": "https://qs.example.net/api"
}
```

- `product` / `version`: free-form implementation identity.
- `quantpub`: the spec version implemented.
- `apiBase`: the absolute base URL under which the §5/§6 endpoints live.

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
  "name": "Morning run",
  "startTime": "2026-08-15T06:30:00+02:00",
  "endTime": "2026-08-15T07:09:00+02:00",
  "metrics": [
    { "key": "duration", "value": 2340, "unit": "seconds" },
    { "key": "distance", "value": 8.2, "unit": "km" },
    { "key": "heartRateAvg", "value": 152, "unit": "bpm" },
    { "key": "hrZoneMinutes", "value": { "z2": 22, "z3": 10 } }
  ],
  "series": [
    {
      "metric": "heartRate",
      "unit": "bpm",
      "bucket": "5s",
      "samples": [
        {
          "start": "2026-08-15T06:30:00+02:00",
          "end": "2026-08-15T06:30:05+02:00",
          "avg": 121,
          "min": 118,
          "max": 124,
          "count": 5
        }
      ]
    }
  ],
  "route": [{ "lat": 59.3251, "lon": 18.071, "t": "2026-08-15T06:30:00+02:00" }]
}
```

- `activityType` (exercise) or `observationOf` (observation) mirrors the
  object's `quant:` property; `name`, `startTime` and `endTime` mirror the
  object's.
- `metrics` MUST contain exactly the shared scalars — the set the delivered
  `Note` summarised.
- `series` MUST contain only series the author _separately_ opted in (§8.2),
  as bucketed samples (§6.1) over the activity window. It MAY be empty.
- `route` (OPTIONAL) is the GPS track as a time-ordered array of
  `{ "lat", "lon", "t" }` (WGS84, ISO 8601), present only under the geography
  opt-in (§8.6). Timestamped points are used instead of a GeoJSON `LineString`
  because GeoJSON carries no per-point time, and the time is what lets a
  consumer sync the route to the series chart. It also exposes position-at-time,
  hence pace; a client offering route sharing SHOULD say so.
- Implementations MAY define further `kind`s (Aurboda adds `article`).
  Consumers MUST ignore unknown kinds.

Authorization follows post visibility: a public or unlisted post resolves
unconditionally; a followers-only post resolves only with a valid capability
token or signed follower fetch (§9); anything else, a nonexistent post
included, returns 404 (§8.3).

### 6. Series endpoint

High-resolution series MUST NOT be embedded in federated objects. They are
served from one public, read-only endpoint:

```
GET {apiBase}/public/{username}/series?metric={key}&start={iso}&end={iso}&bucket={size}
```

`bucket` is an integer followed by `s`, `m`, `h` or `d` (`5s`, `60s`, `1d`).

A request resolves **only when all of the following hold**; this data-driven
check is the entire authorization boundary, and is not obscurity-based:

1. some shared post opted that exact `metric` in as a **series** (a shared
   scalar summary alone MUST NOT satisfy this);
2. that post is publicly visible;
3. the underlying activity still exists (not deleted) and has a bounded window;
4. the activity's window covers the requested `[start, end]`.

Anything else returns 404 (§8.3). The response covers the requested range;
the server SHOULD additionally clamp it to the shared window as defence in
depth. The bucket size MUST be floored server-side (RECOMMENDED minimum: 5
seconds), and only aggregated buckets are returned (§8.5).

#### 6.1 Bucketed samples

```json
{
  "metric": "heartRate",
  "unit": "bpm",
  "bucket": "5s",
  "samples": [
    {
      "start": "2026-08-15T06:30:00+02:00",
      "end": "2026-08-15T06:30:05+02:00",
      "avg": 121,
      "min": 118,
      "max": 124,
      "count": 5
    }
  ]
}
```

Each sample carries `start`, `end`, `avg`, `min`, `max`, `count`, and `sum`
for cumulative metrics such as steps. One shape serves exercise heart-rate
traces, nightly HRV, daily step counts and mood check-ins alike; only the
metric key and bucket size differ.

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

1. **Scalars never imply series.** Sharing `heartRateAvg` MUST NOT expose the
   heart-rate series. A per-sample trace is far more revealing than an average.
2. **Series are a separate, explicit opt-in**, per post, per metric. The
   default for any share MUST be: no series.
3. **Unshared equals nonexistent.** Requests for unshared data MUST return
   404, never 403, so the response cannot reveal that unshared data exists.
4. **Revocation is immediate.** Deleting a post, narrowing its visibility, or
   withdrawing a series opt-in MUST immediately stop the corresponding
   endpoints from resolving. **All** §5 and §6 responses — public and unlisted
   included — MUST be served `Cache-Control: no-store`, so no intermediary
   extends access beyond revocation. Only the discovery document (§4) is
   cacheable.
5. **Bounded resolution.** The bucket floor (§6) is a privacy floor, not only
   a payload bound: implementations MUST NOT serve raw per-measurement series
   timestamps on public endpoints. (A `route`'s per-fix `t` is not a series
   timestamp; it is governed by item 6.)
6. **Geography is its own explicit opt-in.** A route MUST NOT be exposed by
   any scalar or series share; the default MUST be: no route. Publishers
   SHOULD bound route resolution (RECOMMENDED: at most 500 points, or an
   equivalent minimum spacing) and SHOULD apply privacy geo-masking (home-zone
   trimming) before export, not only in rendering.

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
  extension property may be dropped. Two channels are defined:
  (a) the delivered **image attachment URLs** (`?token=` on each `attachment`
  `Image` `url`), which standard AS2 processing preserves — REQUIRED whenever
  the post has image attachments; (b) `quant:structuredUrl` carrying the
  token, the only channel for an attachment-less post. A publisher SHOULD
  attach at least one tokenised image wherever the post has any renderable
  image.
- Consumers SHOULD lift the token from a delivered attachment URL, falling
  back to a same-host `quant:structuredUrl`, and forward it to the payload
  fetch.
- A matching token resolves the payload; anything else is 404 (§8.3).
- Tokens MUST be revocable — regenerated or invalidated when the post is
  deleted or its visibility changes — so that with `no-store` (§8.4)
  revocation is immediate.
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
3. Optionally serve the series endpoint (§6) for the series you explicitly
   share, with the four-condition check and 404 fallback.

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
      "quant:series": { "@type": "@json" }
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
    "content": "<p><strong>Morning run</strong></p><p>Duration 39m · Distance 8.2 km · Heart rate avg 152 bpm · HR zones z2 22, z3 10</p>",
    "published": "2026-08-15T08:02:11+02:00",
    "startTime": "2026-08-15T06:30:00+02:00",
    "endTime": "2026-08-15T07:09:00+02:00",
    "quant:activityType": "running",
    "quant:structuredUrl": "https://qs.example.net/api/public/freja/feed/01J5X0",
    "quant:metrics": [
      { "key": "duration", "value": 2340, "unit": "seconds" },
      { "key": "distance", "value": 8.2, "unit": "km" },
      { "key": "heartRateAvg", "value": 152, "unit": "bpm" },
      { "key": "hrZoneMinutes", "value": { "z2": 22, "z3": 10 } }
    ],
    "quant:series": [
      {
        "metric": "heartRate",
        "mediaType": "application/json",
        "href": "https://qs.example.net/api/public/freja/series?metric=heartRate&start=2026-08-15T06%3A30%3A00%2B02%3A00&end=2026-08-15T07%3A09%3A00%2B02%3A00&bucket=5s"
      }
    ]
  }
}
```

Mastodon renders `content` and any attached chart image; a QuantPub peer
recognises the id shape (or the same-host `quant:structuredUrl`), discovers the
origin and fetches the §5 payload. The inline `"@type": "@json"` definitions
mirror the published `@context`; once the final context IRI is settled,
referencing it alone suffices.

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
    { "key": "sleepDuration", "value": 27600, "unit": "seconds" },
    { "key": "hrvAvg", "value": 64, "unit": "ms" },
    { "key": "sleepScore", "value": 86 }
  ]
}
```

### Series requests and the 404 boundary

```
GET /api/public/freja/series?metric=heartRate&start=2026-08-15T06:30:00%2B02:00&end=2026-08-15T07:09:00%2B02:00&bucket=60s
→ 200, bucketed samples (shared as a series on a public post, window covered)

GET /api/public/freja/series?metric=heartRate&start=2026-08-14T00:00:00Z&end=2026-08-16T00:00:00Z&bucket=60s
→ 404 (window not covered by any shared activity — the share can't be widened)

GET /api/public/freja/series?metric=stress&start=...&end=...&bucket=60s
→ 404 (stress scalar was shared, but its series was not opted in)
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
  ends at home; hence the separate opt-in and the geo-masking recommendation
  (§8.6).

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

- **[Aurboda](https://github.com/fiddur/aurboda)** — ships this document's
  vocabulary on the wire (dual-typed exercise shares with `quant:metrics`,
  `quant:series` and `quant:structuredUrl`), the discovery document, a
  published context at `/ns/quantpub`, the structured post endpoint (activity
  and article kinds, with the optional `route`), the data-driven series
  endpoint, capability tokens conveyed on attachment URLs, and Level 3
  enrichment between Aurboda instances via the §7 id convention. Its payload
  field names still use the earlier snake_case forms and will follow this
  document once naming settles in review.

## Copyright

CC0 1.0 Universal (CC0 1.0) Public Domain Dedication.

To the extent possible under law, the authors of this Fediverse Enhancement
Proposal have waived all copyright and related or neighboring rights to this
work.

[ActivityPub]: https://www.w3.org/TR/activitypub/
[HTTP Signature]: https://datatracker.ietf.org/doc/html/draft-cavage-http-signatures
[RFC-2119]: https://datatracker.ietf.org/doc/html/rfc2119
[FEP-67ff]: https://codeberg.org/fediverse/fep/src/branch/main/fep/67ff/fep-67ff.md
[FEP-400e]: https://codeberg.org/fediverse/fep/src/branch/main/fep/400e/fep-400e.md
