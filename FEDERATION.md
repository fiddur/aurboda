# Federation

This document describes how Aurboda federates over ActivityPub, per
[FEP-67ff](https://codeberg.org/fediverse/fep/src/branch/main/fep/67ff/fep-67ff.md).
It is maintained incrementally as the federated activity feed (issue #831) lands.

## Supported standards

- **ActivityStreams 2.0** for the actor and (upcoming) activity payloads.
- **WebFinger** ([RFC 7033](https://www.rfc-editor.org/rfc/rfc7033)) for actor discovery.
- **HTTP Signatures** for authenticating server-to-server traffic (inbound
  verification and outbound signing land with the inbox/delivery slices).

The implementation is built on [Fedify](https://fedify.dev/).

## Identity & discovery

Each user is a single ActivityPub **actor** (`Person`). There is one actor per
user — the same identity used elsewhere in the app — not separate actors per
feature.

- **Actor document:** `https://<host>/users/<username>` (content type
  `application/activity+json`). A dedicated `/users/` prefix is used (rather than
  the human-facing `/u/<username>` pages) so actor requests never collide with
  the web app's profile/dashboard routes.
- **WebFinger:** `GET /.well-known/webfinger?resource=acct:<username>@<host>`
  returns a JRD whose `self` link points at the actor document.
- **Public key:** the actor publishes an RSA (RSASSA-PKCS1-v1_5 / SHA-256)
  public key, generated per user and stored server-side, used to verify the
  signatures on activities it sends.

Actor collections are advertised at `…/inbox`, `…/outbox`, and `…/followers`.

## Currently implemented

- Actor document + published public key.
- WebFinger discovery.
- Inbox/outbox/followers endpoints are registered (the outbox and followers
  collections are currently empty; the inbox accepts but does not yet process
  inbound activities).

## Planned (tracked in #831)

- **Inbound:** verify HTTP Signatures; handle `Follow` → `Accept`; store
  `Like`/`Announce`/`Create` (reply).
- **Outbound delivery:** a retrying delivery queue that signs and posts
  `Create` / `Update` / `Delete` activities to followers' inboxes when a user
  shares, edits, or unshares an activity.
- **Outbox:** paged `OrderedCollection` of a user's public posts.

## Aurboda extensions

A shared activity is delivered as a `Create` whose object is dual-typed
`["Note", "aurboda:Exercise"]` — `Note` first so plain fediverse clients render
`content`/`name`/`url` as a status, with structured `aurboda:` fields
(`activityType`, `startTime`/`endTime`, `durationSeconds`, `metrics`, `series`)
for Aurboda↔Aurboda consumers. The `aurboda:` terms are defined by a JSON-LD
context document published at `https://<host>/ns/activitystreams` (served with
the delivery slice). Only the metrics a user explicitly shared are ever emitted;
high-resolution series are referenced as links to the public, data-scoped
`/series` endpoint rather than inlined.
