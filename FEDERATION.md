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
- Hosted challenges as `["Event", "quant:Challenge"]` objects at
  `/users/<username>/challenges/<slug>` (see [Challenges](#challenges-http-outside-activitypub)).
- Inbox/outbox/followers endpoints are registered (the outbox and followers
  collections are currently empty; the inbox accepts but does not yet process
  inbound activities).

## Outbound delivery

Outgoing activities are signed and posted to each recipient's inbox through a
persistent queue (Fedify's outbox and fan-out queues, kept in pg-boss in the
server's own database), so a follower's server that is down when a post is
shared still gets it later:

- A failed delivery is retried with exponential backoff: the first retry after
  one to two minutes, each wait four times the last, capped at 12 hours between
  attempts, ten attempts in all (roughly two to three days). A server that keeps
  failing within minutes has its deliveries held for a while (Fedify's circuit
  breaker) instead of hammered; a held delivery is dropped after three days.
- An inbox answering `404 Not Found` or `410 Gone` is given up on at once.
- Only outgoing activities are queued; incoming ones are processed as they
  arrive.
- Followers-only posts are queued like public ones. The queued job holds the
  activity and the signing key in the server's own database; nothing of a
  payload is written to the logs.
- The relay `Follow` an admin sends is posted at once instead, so its error
  shows on the relay straight away.
- Servers whose inboxes could not be reached are listed for admins (see
  [`docs/admin.md`](docs/admin.md#federation)).
- A server without a job queue (no database credentials for pg-boss) delivers
  synchronously instead, without retries; the startup log says which mode is
  active.

## Planned (tracked in #831)

- **Inbound:** verify HTTP Signatures; handle `Follow` → `Accept`; store
  `Like`/`Announce`/`Create` (reply).
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

## Quote posts (FEP-044f)

Mastodon (4.4+) only offers "Quote" on a remote post that declares a quote
policy, and treats a missing one as "nobody may quote". Every Note Aurboda
delivers or serves therefore carries `interactionPolicy.canQuote`, and quote
requests are answered per [FEP-044f](https://w3id.org/fep/044f):

- `public`/`unlisted` posts declare `canQuote.automaticApproval: Public`;
  `followers`-only posts allow only the author.
- An inbound `QuoteRequest` for a public/unlisted post is answered with an
  `Accept` whose `result` is a `QuoteAuthorization` stamp served at
  `https://<host>/users/<username>/stamps/<id>`; anything else gets a `Reject`.
- A stamp stops resolving (404) once its post is unshared or deleted.

Posts federated before quote policies were added keep Mastodon's cached "nobody"
policy until an `Update` of them reaches it; editing the post sends one.

## Challenge threads

A challenge hosted here has a comment thread (see
[docs/features/challenges.md](docs/features/challenges.md#comment-thread)), and comments
reach it over ActivityPub:

- **Outgoing.** A challenge comment (a reply `Note`) and a share of a challenge carry the
  challenge object id (`/users/<username>/challenges/<slug>`) as `context`. A public
  comment is addressed like any reply. A participants-only comment pushed to a thread is
  addressed `to` the host and the thread's attendees alone, with an empty `cc`: never
  `as:Public` or followers.
- **Thread document.** `GET /users/<username>/challenges/<slug>/thread` (outside the API
  base, `no-store`) serves a hosted challenge's thread as a QuantPub `challengeThread`
  document, named by `threadUrl` on the challenge document.
  - The request is verified with Fedify. A signer matched to an active remote member
    (by its actor, or the actor its identity resolves to) is stamped verified. It gets
    every visible entry, both audiences and the attendees.
  - Anyone else gets the public entries only.
  - A member's server pulls it signed as the member (RSA key, through the SSRF-guarded
    fetch), at join and when its copy is more than five minutes old.
- **Push.** The host delivers each comment written, edited or deleted on its side
  (`Create`, `Update`, `Delete`) to its verified members. A member's server delivers its
  user's comments to the host and the attendees.
- **Member inbox.** A `Note` in a member's inbox goes into the member's copy of a remote
  thread under these conditions:
  - its `context` names the challenge object of an active participation;
  - the sender is that challenge's host actor or one of the thread's attendees;
  - the sender is not the member themselves;
  - the Note passes the same authority check as below.
    A copy row written by another actor is never overwritten. A Note from anyone else marks
    the copy for a fresh pull. A `Delete` from the author removes the copy row.
- **Incoming.** A `Create{Note}` in any local user's inbox enters the thread when its
  `inReplyTo` is the challenge object, a local post of the thread, or an entry of a thread
  the recipient hosts. Authority is the timeline's: the Note's id is on the sender's host
  and its `attributedTo` names the sender.
- **Audience.** A Note addressed to `as:Public` is a public entry. Any other Note is a
  participants-only entry, admitted only when its `context` names the challenge and the
  sender is the host or an active member, so a followers-only reply is never widened. An
  unlisted challenge takes participants-only entries from its participants alone.
- **Rate limit.** A sender who is not a participant adds at most 30 new entries a day to
  one thread; an `Update` of an entry they already have is not counted.
- **Delivery limit.** A reply to a remote commenter's comment is only seen when it is
  delivered to the host's inbox, which Mastodon does when the reply keeps the host's
  mention.
- **Update and Delete.** An `Update` rewrites the entry; a `Delete` from its author removes
  it (with its replies), and an actor deleting itself loses every entry it wrote in the
  threads the recipient hosts. A
  `Delete` from anyone else changes nothing.

A Note admitted to a thread still becomes a timeline card where it would have before, but
the recipient who already gets `challenge_comment` for it gets no second notification.

## Challenges (HTTP, outside ActivityPub)

Federated challenges use the HTTP half of the
[QuantPub Challenges](docs/fep/quantpub-challenges.md) draft, advertised by
`"challenges": true` in `/.well-known/quantpub`: a challenge listing and document
(`GET /api/public/<username>/challenges[/<slug>]`), HTTP join and leave
(`POST` / `DELETE …/challenges/<slug>/members`), standings
(`GET …/challenges/<slug>/standings`) and a member's entry
(`GET /api/public/<username>/challenge-entries/<token>`). Of the ActivityPub half,
each hosted challenge (public or unlisted) is served as an `["Event", "quant:Challenge"]`
object at `/users/<username>/challenges/<slug>`; `Join` / `Leave` and delivering the
`Event` are not implemented yet. Aurboda's older
challenge protocol (`/.well-known/aurboda`) is still served for instances that predate
it. See [docs/features/challenges.md](docs/features/challenges.md).
