---
slug: "xxxx"
authors: Fredrik Liljegren <@fiddur@aurboda.net>
status: DRAFT
dateReceived: (not yet submitted)
---

# FEP-xxxx: QuantPub Challenges — federated competitions over shared metrics

> **Status of this document.** A pre-submission companion to
> [FEP-302f] (QuantPub), developed in the open in the
> [Aurboda](https://github.com/fiddur/aurboda) repository. It describes the
> protocol Aurboda is moving its federated challenges to; the sections marked
> _Aurboda today_ say how the running code differs while the move is under way.
> The FEP number is a placeholder until submission.

## Summary

A **challenge** is a competition over one personal metric — steps in November,
hours of strength training this quarter, kilometres cycled in a week — hosted by
one person and joined by others, each on their own instance or home-built
tracker. This proposal defines:

1. **A challenge object** — an AS2 `Event` (following [FEP-8a8e]) dual-typed
   `quant:Challenge`, carrying what is measured as a [FEP-302f] metric key, the
   scoring rule and the window. Event-aware servers list it as an event;
   Mastodon-class servers render it as a status; QuantPub peers read the rest.
2. **Joining and leaving** — AS2 `Join` / `Leave` answered with `Accept` /
   `Reject`, as [FEP-8a8e] defines for events, with an HTTP equivalent for
   participants that have no ActivityPub actor (a [FEP-302f] Level 1
   publisher).
3. **Entries** — each member serves its own progress at a capability URL in the
   [FEP-302f] §6.1 bucketed-sample shape; the host **pulls** entries and
   publishes standings. A static JSON file is a valid entry.
4. **Standings and results** — a public standings document on the host, and a
   result post that mentions the winners.

Everything builds on [FEP-302f]: its discovery document, metric keys and units,
the `kind`-discriminated JSON payload pattern, and its privacy model (unshared
is 404, responses are `no-store`, revocation is immediate).

## Motivation

[FEP-302f] lets people share workouts and daily metrics across the fediverse,
but a friendly competition needs more than a stream of posts: a shared window,
a shared metric, a way to opt in, and one place that adds things up. Fitness
platforms offer this inside their walls (Strava clubs, Garmin and Fitbit
challenges); nothing federated exists. Of the fediverse fitness projects —
FitPub, FitTrackee, wanderer, Open Pace — none has challenges, and no FEP
covers competitions. [FEP-8a8e] (events) is the nearest building block: a
time-bounded object with organizers, attendees and `Join` semantics.

Aurboda runs cross-instance challenges today over a small vendor protocol
(§10). This document is that protocol made vendor-neutral and put on top of
QuantPub, so that any QuantPub implementation — down to a weekend-built
tracker that serves one JSON file — can host or join.

## Requirements

The key words "MUST", "SHOULD", "MAY" are to be interpreted as described in
[RFC-2119].

## Specification

### 1. Roles and conformance

- **Host** — the instance of the person who created the challenge. A host at
  [FEP-302f] Level 1 serves the challenge document (§3), accepts HTTP joins
  (§4.2) and serves standings (§6). A Level 2+ host also serves the challenge
  as an AS2 object (§2), handles `Join` / `Leave` (§4.1) and delivers the
  result post (§7).
- **Member** — a participant's instance or tracker. A Level 1 member serves an
  entry (§5) and joins over HTTP. A Level 2+ member MAY join with `Join`.

Both paths lead to the same member record on the host, so a challenge can mix
ActivityPub instances and plain-JSON trackers. Names are lowerCamelCase on both
layers, as in [FEP-302f] §1; the `quant:` namespace is `https://w3id.org/quantpub#`.

### 2. `quant:Challenge` — the challenge object

A challenge is an AS2 object, RECOMMENDED to be dual-typed
`["Event", "quant:Challenge"]` — `Event` first. The choice of `Event` over
`Note` is deliberate: [FEP-8a8e] already defines the window, organizers,
attendees and `Join` handling this proposal needs, event servers (Mobilizon,
Gancio, Friendica, GatherPress) list it in a calendar, and Mastodon accepts
`Event` as a convertible type and shows the name and link as a status. A
publisher whose consumers mishandle array-valued `type` MAY emit a single-typed
`Event` (see [FEP-302f] §10); detection keys on `quant:structuredUrl` or the
id convention (§3), never on the type.

| Property              | Type                             | Notes                                                                      |
| --------------------- | -------------------------------- | -------------------------------------------------------------------------- |
| `name`                | string                           | REQUIRED. The challenge name                                               |
| `startTime`           | ISO 8601                         | REQUIRED. Start of the window ([FEP-8a8e])                                 |
| `endTime`             | ISO 8601                         | REQUIRED. End of the window, exclusive                                     |
| `timezone`            | IANA zone                        | REQUIRED. The zone days are counted in, for every member ([FEP-8a8e])      |
| `attributedTo`        | actor id                         | REQUIRED. The host actor; `organizers` ([FEP-8a8e]) MAY repeat it          |
| `attendees`           | Collection                       | RECOMMENDED. Current members with `totalItems` ([FEP-8a8e])                |
| `joinMode`            | `free` \| `restricted` \| `none` | RECOMMENDED. `restricted`: the host approves; `none`: closed ([FEP-8a8e])  |
| `quant:metric`        | string                           | REQUIRED. A [FEP-302f] §2.1 key (`steps`, `duration`, …) or `prefix:name`  |
| `quant:unit`          | UCUM code                        | REQUIRED for an extension key, MUST be omitted or canonical for a bare key |
| `quant:scoring`       | `sum` \| `count` \| `max`        | REQUIRED. How a member's samples become a score (§5)                       |
| `quant:bucket`        | `1d` (default) \| `1h` \| `7d`   | OPTIONAL. The sample width standings are drawn at ([FEP-302f] §6 syntax)   |
| `quant:structuredUrl` | URL                              | OPTIONAL. The §3 document, where the id convention does not apply          |
| `content`             | HTML                             | RECOMMENDED. A readable summary for plain clients                          |

`published` orders the object in timelines; the challenge's time is
`startTime`. A Level 2 host SHOULD mint the id as
`{webBase}/users/{username}/challenges/{slug}` so that a consumer resolves the
§3 document at `{apiBase}/public/{username}/challenges/{slug}` with `{apiBase}`
from the discovery document, exactly as [FEP-302f] §7 does for posts.

A metric is scored from what each member chose to share for this challenge
alone; nothing about a challenge grants access to any other data of a member
(§8).

### 3. Discovery and the challenge document

The [FEP-302f] §4 discovery document gains one key:

```json
{
  "product": "my-qs-tool",
  "version": "1.0.0",
  "quantpub": "0.3",
  "challenges": true,
  "apiBase": "…"
}
```

`challenges: true` says the implementation serves and accepts this proposal's
endpoints. A Level 2+ implementation MAY additionally advertise it per
[FEP-844e] with `https://w3id.org/quantpub/challenges` in `implements`.

A host MUST serve, `no-store`:

```
GET {apiBase}/public/{username}/challenges/{slug}
```

```json
{
  "kind": "challenge",
  "id": "https://qs.example.net/users/freja/challenges/november-steps",
  "url": "https://qs.example.net/u/freja/november-steps",
  "name": "November steps",
  "metric": "steps",
  "scoring": "sum",
  "bucket": "1d",
  "startTime": "2026-11-01T00:00:00+01:00",
  "endTime": "2026-12-01T00:00:00+01:00",
  "timezone": "Europe/Stockholm",
  "joinMode": "free",
  "joinToken": "k7Qf…",
  "host": {
    "name": "freja",
    "url": "https://qs.example.net/u/freja",
    "actor": "https://qs.example.net/users/freja"
  },
  "members": [{ "name": "ola", "url": "https://ola.example/", "actor": null }],
  "standingsUrl": "https://qs.example.net/api/public/freja/challenges/november-steps/standings"
}
```

`id` and `actor` are present only where an AS2 object or actor exists (Level
2+). `joinToken` is an unguessable string handed to anyone who can read the
document; presenting it in an HTTP join (§4.2) proves the joiner read the
challenge. It is rotated when the host wants to stop new joins from an old
link. A `public` challenge is also listed at
`GET {apiBase}/public/{username}/challenges`, a `kind: "challengeList"`
document whose `items` are the same documents without `joinToken` and
`members`, which is how a peer discovers open challenges from people its users
follow. An `unlisted` challenge is reachable
by slug only and is not listed.

### 4. Joining and leaving

A member joins once and is then pulled from (§5). Both paths register the same
three things: who the member is, how to show them, and where their entry is.

#### 4.1 ActivityPub (Level 2+ on both sides)

The member's actor sends `Join` to the host actor's inbox, addressed as
[FEP-8a8e] requires (`to` the host; `as:Public` when the challenge is public):

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/quantpub/context.jsonld"
  ],
  "type": "Join",
  "id": "https://ola.example/users/ola/activities/01J…",
  "actor": "https://ola.example/users/ola",
  "object": "https://qs.example.net/users/freja/challenges/november-steps",
  "instrument": {
    "type": "Link",
    "href": "https://ola.example/api/public/ola/challenges/entries/x9Tb…",
    "mediaType": "application/json",
    "rel": "quant:entry"
  }
}
```

`instrument` carries the entry URL (§5). It is used rather than an extension
property because `instrument` is AS2 core, so typed processors preserve it,
the same reason [FEP-302f] §9 routes tokens through attachment URLs.

The host fetches the instrument once (SSRF-guarded) and answers `Accept{Join}`
— the member is added to `attendees` — or `Reject{Join}` (closed, full,
unreadable entry, entry scoring a different metric, see §5). With
`joinMode: restricted` the host MAY answer later; until then the member is
pending. The member leaves with `Leave{object: challenge}`; the host removes
it from `attendees` and MAY answer `Accept{Leave}`. The host removes a member
with `Remove{object: member actor, target: attendees}` delivered to the
member.

#### 4.2 HTTP (any level)

```
POST {apiBase}/public/{username}/challenges/{slug}/members
```

```json
{
  "joinToken": "k7Qf…",
  "name": "ola",
  "url": "https://ola.example/",
  "actor": null,
  "entryUrl": "https://ola.example/api/public/ola/challenges/entries/x9Tb…"
}
```

`url` is the member's public page (shown on the leaderboard, with its host);
`actor` is OPTIONAL and lets a Level 2 host mention the member in the result
post (§7). The host fetches `entryUrl` once and answers:

| Status | Meaning                                                                                      |
| ------ | -------------------------------------------------------------------------------------------- |
| 200    | `{ "status": "member" }` or `{ "status": "pending" }` (`joinMode: restricted`)               |
| 400    | Malformed body, or `entryUrl` did not answer with a valid entry                              |
| 403    | Wrong `joinToken`                                                                            |
| 404    | No such challenge                                                                            |
| 409    | Closed, full, the entry scores a different metric, or `url` is registered with another entry |

A registered `url` is an identity, and its registered `entryUrl` is the
capability that proves a caller is that member: a second `POST` for the same
`url` MUST carry the currently registered `entryUrl` as `currentEntryUrl` to
change `name` or `entryUrl`, and is otherwise `409`; `DELETE` on the same path
with `{ "entryUrl" }` leaves. Holding `joinToken` therefore lets anyone join,
never take over or remove someone who has.

### 5. Entries — a member's progress

An entry is what the host reads. It is served at the capability URL the member
registered, `no-store`, and 404s once the member has left (every other
condition is 404 too, [FEP-302f] §8.4):

```json
{
  "kind": "challengeEntry",
  "challenge": "https://qs.example.net/users/freja/challenges/november-steps",
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

- `metric` and `scoring` MUST echo the challenge's. A host MUST refuse (§4) or
  stop counting an entry that echoes something else: an implementation that
  does not know an extension key must not score some other quantity under its
  name.
- `total` is the score so far under `scoring`: the samples' `sum`s added
  (`sum`), the samples counted (`count`), or the best sample (`max`). Without
  `total` the host computes it from the samples.
- `series` is one [FEP-302f] §6.1 series. `offset` is seconds since the
  challenge `startTime`; a sample covers one `bucket` of the challenge's
  `timezone` starting at that offset, so a day sample's offset is that of the
  local midnight (23- and 25-hour days included). `samples` MAY be omitted
  for a `total`-only entry; it is then shown as a total without a chart.
- `lastUpdated` is when the member's underlying data last changed, or `null`
  when there is none yet; it MUST NOT be the request time.
- The entry MUST contain nothing outside the window and nothing but the one
  metric. It is the only thing a challenge ever reads from a member.

The host SHOULD fetch entries at most every few minutes and MUST bound each
fetch (timeout, size, no redirects, public addresses only). A fetch that fails
keeps the last entry, marked stale (§6); an entry that 404s is a departure.

### 6. Standings

```
GET {apiBase}/public/{username}/challenges/{slug}/standings
```

```json
{
  "kind": "standings",
  "challenge": "https://qs.example.net/users/freja/challenges/november-steps",
  "asOf": "2026-11-03T21:45:12Z",
  "bucket": "1d",
  "members": [
    {
      "rank": 1,
      "name": "ola",
      "url": "https://ola.example/",
      "actor": null,
      "total": 123456,
      "lastUpdated": "2026-11-03T21:40:00+01:00",
      "stale": false,
      "samples": [{ "offset": 0, "sum": 8412 }]
    }
  ]
}
```

Members are ordered by `total` with competition ranking (equal totals share a
rank). `stale` is `true` when the latest fetch failed and `total` is last-known.
`samples` are the member's entry samples re-bucketed to `bucket`, so every
member's chart lines up. A member who left is not listed. The standings of a
`public` challenge MAY be cached briefly; those of an `unlisted` one MUST be
`no-store`, since the slug is the only gate.

### 7. Results

When the window has closed and every entry has been read once more (a host
SHOULD wait a grace period for last-day data to sync), the host freezes the
standings and, at Level 2, delivers a `Create{Note}` to the challenge's
audience: the podium as readable `content`, each winner as a `Mention` tag
addressed in `cc` (so their instance notifies them whether or not they follow
the host), and `quant:structuredUrl` pointing at the frozen §6 document. The
host also delivers `Update{Challenge}` with `joinMode: none`. A member
registered over HTTP with an `actor` is mentioned like any other; one without
is named in the text.

### 8. Privacy and trust (normative)

1. **Joining is the member's choice**, and exposes exactly one metric over
   exactly one window, through one URL only the host is told. Nothing in this
   proposal grants a host, or anyone, access to a member's posts, series or
   other metrics ([FEP-302f] §8).
2. **Leaving is immediate.** Once a member leaves, its entry MUST 404 and the
   host MUST stop showing it; `no-store` keeps intermediaries from extending
   access. A host MAY keep a frozen result that was published while the member
   was still in.
3. **Entries are self-reported.** Nothing here verifies a step count; a
   malicious member can serve any number. Hosts and consumers MUST present
   standings as what members reported, and a host MAY remove a member at any
   time. HTTP Signatures on entry fetches and [FEP-8b32] proofs on entries are
   possible hardening, not requirements: the baseline is a friendly
   competition, and a Level 1 tracker has no keys.
4. **The entry URL is a capability**, generated with a cryptographically
   secure RNG and shown on no public surface. The host MUST NOT publish it; the
   §6 document carries totals and samples, never the URL they came from.

### 9. Coexistence and incremental adoption

Every part is additive to [FEP-302f]: one key in the discovery document, new
routes under `{apiBase}/public/{username}/challenges/`, one new object type
and the `Join` / `Leave` pair. A Level 1 implementation hosts or joins with
three routes and no ActivityPub; a Level 2 implementation adds the object and
the inbox handlers when it is ready, and HTTP joins keep working meanwhile.

### 10. Aurboda today

Aurboda's running challenge protocol ([docs/features/challenges.md]) is this
proposal's ancestor, Aurboda-to-Aurboda only. The mapping:

| Aurboda today                                     | This proposal                                             |
| ------------------------------------------------- | --------------------------------------------------------- |
| `/.well-known/aurboda`, `product: "aurboda"`      | `/.well-known/quantpub`, `challenges: true`               |
| `GET /public/{user}/{slug}` → `type: "challenge"` | `GET …/challenges/{slug}` → `kind: "challenge"`           |
| `spec.pattern`, `spec.aggregation`, `spec.unit`   | `metric` (a §2.1 key), `scoring`, canonical unit          |
| `join_token`, `POST …/{slug}/members`             | `joinToken`, `POST …/challenges/{slug}/members`           |
| `identity_base_url`, `display_name`               | `url`, `name`, OPTIONAL `actor`                           |
| `data_endpoint_url` → `{ total, buckets }`        | `entryUrl` → `kind: "challengeEntry"` with §6.1 samples   |
| `buckets[].bucket_start` (ISO)                    | `samples[].offset` from `startTime`                       |
| measure echo (`measure`, `filter_*`)              | `metric` echo, extension key for a measure                |
| `GET …/{slug}/standings`                          | `GET …/challenges/{slug}/standings` → `kind: "standings"` |
| `challenge` feed post (`Note` + link)             | `Create{Event, quant:Challenge}` and the result `Note`    |
| no `Join`; register-back only                     | `Join` / `Leave` at Level 2, register-back at Level 1     |

Aurboda serves the HTTP half of this proposal — the discovery flag, the
challenge document and listing (§3), HTTP join and leave (§4.2), entries (§5) and
standings (§6) — alongside the old protocol, prefers it when joining a host that
advertises `challenges: true`, and reads either shape from members, so instances
on either side of the move keep competing. Its documents carry a vendor `aurboda`
block (the exact spec on a challenge, the measure echo on an entry) that other
implementations ignore. The ActivityPub half — the `Event` object (§2), `Join` /
`Leave` in the inbox (§4.1) and `attendees` — is not yet implemented, nor is
`joinMode: restricted`.

## Security considerations

- Entry and standings fetches are the host's outbound requests to URLs that
  members chose: SSRF guards (public addresses only, no redirects, bounded
  size and time) are REQUIRED, as in [FEP-302f].
- `joinToken` gates nothing but registration; it is in a document anyone with
  the link can read, so a host MUST also cap members and MUST NOT let a token
  holder overwrite another member's registration (`url` is the identity, and
  a registered `entryUrl` is the proof for `DELETE`).
- Self-reported numbers (§8.3) are the design, not an oversight: a challenge
  is a social object, and the remedy for a cheat is removal, not cryptography.

## Prior art

- **[FEP-8a8e]** — the `Event` conventions this proposal reuses: window,
  `timezone`, `organizers`, `attendees`, `joinMode`, `Join` answered with
  `Accept` / `Reject`. A challenge is an event whose attendees compete.
- **Mobilizon** — `Join` / `Leave` on events and groups, `participationMessage`
  for restricted joins; the installed base of the pattern.
- **[FEP-1b12]** — group federation. Considered and not used: a challenge has a
  host and a window rather than an open membership, and its activities are
  pulled entries, not announced posts.
- **[FEP-400e]** — publicly-appendable collections. A natural way to let
  members _push_ entries (`Create{Observation}` with `target` the challenge's
  entries collection); left as a future extension because pull is the one
  model a Level 1 tracker can take part in.
- **[FEP-efda]** — followable objects; a challenge MAY expose `followers` so
  that members are notified of updates without following the host.
- **Strava, Garmin, Fitbit challenges** — the in-silo feature this
  federates; same honour-system trust.

## References

- [FEP-302f] QuantPub — federated personal metrics for quantified-self sharing
- [FEP-8a8e] A common approach to using the Event object type
- [FEP-1b12] Group federation
- [FEP-400e] Publicly-appendable ActivityPub collections
- [FEP-efda] Followable objects
- [FEP-844e] Capability discovery
- [FEP-8b32] Object Integrity Proofs
- [RFC-2119] Key words for use in RFCs to Indicate Requirement Levels

[FEP-302f]: https://codeberg.org/fediverse/fep/src/branch/main/fep/302f/fep-302f.md
[FEP-8a8e]: https://codeberg.org/fediverse/fep/src/branch/main/fep/8a8e/fep-8a8e.md
[FEP-1b12]: https://codeberg.org/fediverse/fep/src/branch/main/fep/1b12/fep-1b12.md
[FEP-400e]: https://codeberg.org/fediverse/fep/src/branch/main/fep/400e/fep-400e.md
[FEP-efda]: https://codeberg.org/fediverse/fep/src/branch/main/fep/efda/fep-efda.md
[FEP-844e]: https://codeberg.org/fediverse/fep/src/branch/main/fep/844e/fep-844e.md
[FEP-8b32]: https://codeberg.org/fediverse/fep/src/branch/main/fep/8b32/fep-8b32.md
[RFC-2119]: https://tools.ietf.org/html/rfc2119.html
[docs/features/challenges.md]: ../features/challenges.md

## Copyright

CC0 1.0 Universal (CC0 1.0) Public Domain Dedication

To the extent possible under law, the authors of this Fediverse Enhancement
Proposal have waived all copyright and related or neighboring rights to this
work.
