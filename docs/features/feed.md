# Activity Feed

The activity feed lets a user publish an **activity** (a run, a night's sleep, a
meditation, …) to their public feed, choosing **per post exactly which data leaves the
instance**. It reuses the same base-URL identity and `/u/<username>` namespace as
[shared dashboards](./sharing.md) and [challenges](./challenges.md).

This page describes the **persistence + share API + public series** foundation. The
ActivityPub delivery layer (actor, outbox/inbox, HTTP signatures, follower delivery)
and server-side map/chart image rendering are layered on top of this model in
follow-up work; they are intentionally **not** part of this foundation.

## Feed posts

A **feed post** references one of the user's activities and records the explicit metric
selection that bounds what is shared:

- **`included_metrics`** — the scalar summaries the user opted to share (e.g.
  `duration`, `distance`, `heart_rate_avg`, `hr_zone_minutes`). This is the single
  source of truth for the human-readable summary and the machine-readable scalars a
  remote Aurboda instance reads.
- **`series_metrics`** — a **separate, explicit opt-in** for high-resolution continuous
  series (e.g. per-5-second heart rate or stress). A per-sample trace is far more
  revealing than an average, so series are **off unless deliberately chosen**, even for
  a metric whose scalar summary is shared.
- **`visibility`** — `public`, `followers`, or `unlisted`.
- **`include_map` / `include_chart`** — flags for the (deferred) image attachments.

Defaults are privacy-conservative: sharing an activity with no explicit selection
shares no scalars and, crucially, **no series**.

## Public series endpoint (the privacy boundary)

High-resolution series are **never** embedded in a post. Instead each shared series is
exposed through a public, read-only endpoint:

```
GET /public/:username/series?metric=<key>&start=<iso>&end=<iso>&bucket=<5s|60s|…>
```

Like a shared-dashboard slug, it takes **no auth token** — so the scoping below is the
*entire* privacy boundary, and it is **data-driven, not obscurity-based**. A request
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

## API

Owner-facing (authenticated, scoped to the caller):

| Method & path                        | Purpose                                            |
| ------------------------------------ | -------------------------------------------------- |
| `GET /feed`                          | List my feed posts                                 |
| `POST /feed/activities/:id/share`    | Publish an activity with a chosen metric selection |
| `PATCH /feed/:postId`                | Edit selection / visibility / attachments          |
| `DELETE /feed/:postId`               | Unpublish (its public series stops resolving)      |

Public (unauthenticated):

| Method & path                    | Purpose                                                    |
| -------------------------------- | ---------------------------------------------------------- |
| `GET /public/:username/series`   | Bucketed samples for a **shared** series within its window |

The same owner-facing capability is available over MCP as `list_feed`, `share_activity`,
`update_feed_post`, and `delete_feed_post`. The public series read is web/federation-only.

## Storage

Feed posts live in the user's own database in the `feed_posts` table. `activity_id` is a
**soft reference** (no foreign key): activities are soft-deleted and the series lookup
re-checks `deleted_at` at query time, so a removed activity simply stops resolving rather
than cascading a delete. A GIN index over `series_metrics` backs the public series
endpoint's authorization check.

## Related

- [Sharing & public pages](./sharing.md) — the shared-dashboard foundation and the
  base-URL identity model this reuses.
- [Challenges](./challenges.md) — cross-instance federated competitions on the same
  `/u/:username` namespace.
