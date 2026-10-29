# Gravl

[Gravl](https://gravl.ai/) is a strength-training log. Its read-only REST API carries the one thing that never reached Aurboda automatically before: the actual sets — exercise, weight, reps, set type, RPE. Aurboda pulls workouts through the [Gravl API](https://gravl.ai/developers) and attaches that detail to the strength session Health Connect already delivered, or creates the activity when Health Connect did not.

## Data Synced

| Gravl Data     | Stored As                                                                                                | Notes                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Workouts       | `strength_training` activity, source `gravl`                                                             | Keyed by `gravl-workout-<uuid>`; title is the workout name                         |
| Sets           | `data.sets` array on the activity                                                                        | One entry per set with the exercise repeated (see [The set shape](#the-set-shape)) |
| Workout totals | `data.volume_kg`, `data.calories`, `data.personal_record_count`, `data.set_count`, `data.exercise_count` |                                                                                    |
| Workout notes  | A synced note (`source = 'gravl'`)                                                                       | Only when the workout has notes                                                    |

Every workout is also preserved as raw JSON in the `raw_records` table (`record_type = 'gravl_workout'`).

### The set shape

Each set is an item of the `sets` list field of the built-in `strength_training` data schema (see [Activity types → Data Schema](./features/activity-types.md#data-schema-and-categorical-fields)): `exercise`, `weight`, `reps` and `time` are its declared item fields, and Gravl's other keys (`exercise_id`, `order`, `set_type`, `distance`, `rpe`, `superset_id`) are kept as undeclared item keys.

```json
{
  "exercise": "Bench Press",
  "exercise_id": 12,
  "order": 2,
  "set_type": "normal",
  "weight": 80,
  "reps": 8,
  "time": null,
  "distance": null,
  "rpe": 8,
  "superset_id": 3
}
```

- `weight` is kilograms. Gravl reports every weight in **pounds** regardless of the account's unit preference; the sync converts (÷ 2.20462262, rounded to three decimals — 48.50164 lb round-trips to exactly 22 kg).
- `time` is seconds (planks, holds), `distance` metres (carries). Zero values are stored as `null`.
- `set_type` is `normal`, `warmup`, `drop_set` or `failure`. Gravl exposes warmup sets the app hides, so the API is richer than the app.
- `superset_id` is present only when Gravl reports one (it currently reads null everywhere).
- `exercise` passes through the [item value aliases](./features/activity-types.md#merging-values-and-aliases) before it is stored: an exercise merged into another is stored under the name it was merged into.

The activity page renders `data.sets` as a per-exercise summary with the sets table under it. Gravl's own workout notes, when the workout has any, become a synced note (`source = 'gravl'`); the sets are not repeated in it. Notes written before this change, which carried a text rendering of the sets, were cut down to the workout notes (or removed) by a one-off migration (`gravl_sets_note_v1`).

### What is deliberately not imported

- **`External` workouts** (`type: "external"` in the API, which spells its enums in lower camelCase). These are Health Connect sessions round-tripped _into_ Gravl from other apps (Garmin, Polar, …). Gravl stores the imported session as a single cardio pseudo-exercise (Walking, Running, …) whose one set holds duration and distance — no exercise data — and importing them would give every watch session a third copy.
  The Gravl app also writes them _back_ into Health Connect as strength-training sessions under its own `gravl-session-<uuid>` id, so they first land here as a `gravl` activity (see [Enrich, don't duplicate](#enrich-dont-duplicate)). As soon as the Gravl API reports the workout as `External` — the enrichment job a minute after the Health Connect upload, or the next poll — that copy is soft-deleted and the original session (the Garmin activity, or the other app's Health Connect row) is the one shown again. The soft delete is a tombstone: a re-delivered Health Connect record does not resurrect it. The note Gravl synced onto the row is removed with it; comments you wrote on it are kept.
  The exception is an `External` workout onto which you logged sets in Gravl ([#1333](https://github.com/fiddur/aurboda/issues/1333)): it is imported like any other workout. A set counts as logged when it has reps, a weight, or a time without a distance (a plank, not the pseudo-exercise's cardio set). The list only reports an exercise count and a volume, so a run fetches the detail of an `External` workout only when it has two or more exercises or a positive volume; the rest are removed without a detail request. A copy removed by an earlier run is restored when the sets appear (a row you deleted after its sets were imported stays deleted), and then merges with the watch original as usual — Gravl's sets, the watch's heart rate. The pseudo-exercise is left out of the imported session, so `data.sets` holds only what you logged.
- **Workouts without a logged set** — started in Gravl and abandoned. They carry nothing Aurboda does not already have, and an empty `strength_training` row would outrank the watch original in the cross-source merge.
  The empty row an earlier import wrote for such a workout (its `data.sets` is an empty array) is retracted the same way as the `External` copies: soft-deleted, with supersession recomputed so the original shows again. A Health Connect session stored under the Gravl identity has no `sets` (or, if an import before #1099 merged an empty `sets` into it, still carries its Health Connect `metadata`) and is left alone.
  The retraction is undone when the workout later gains sets in Gravl: the next poll or enrichment restores the row and stores the sets on it.
- Heart rate, GPS and per-set notes are not in the Gravl API; HR and location come from the watch (Garmin / Health Connect) on the same activity.
- Personal records, body measurements, templates and splits — see the follow-ups in [#1042](https://github.com/fiddur/aurboda/issues/1042).

## Enrich, don't duplicate

Most Gravl users already get their sessions through Health Connect: the Gravl app writes a `strength_training` session with correct timing and heart rate, `dataOrigin: com.liteup.getgains`, and its `clientRecordId` is literally `gravl-session-<workout-uuid>`.

Aurboda uses that key ([#1080](https://github.com/fiddur/aurboda/issues/1080)): a Health Connect session from Gravl is stored **as the Gravl activity** — `source = 'gravl'`, `external_id = 'gravl-workout-<uuid>'` — instead of as a `health_connect` row. The Gravl sync upserts onto the same row and adds the sets. No second row, nothing to merge, and the Gravl and Health Connect start times (which differ by a few seconds) never matter.

Sessions Health Connect delivered _before_ this existed are claimed the first time the Gravl sync sees their workout: the old `health_connect` row is re-sourced and enriched in place.

When both a Garmin watch and Gravl record the same session, the Garmin and Gravl rows still merge in the timeline (Gravl ranks above Garmin in the cross-source merge, so the row with the sets wins and Garmin's HR is blended in).

## Admin Setup

None is required. Optionally, register an OAuth app so users can connect with a click instead of pasting a token:

1. Email `developers@gravl.ai` with the app name, the redirect URI `https://<your-api-host>/auth/gravlcb` (shown in Admin Settings), and the scopes — `workouts:read` is all the sync needs. Registration is manual while the API is in beta.
2. Enter the issued client ID (`gci_…`) and secret (`gcs_…`) under **Admin Settings → Gravl API**.

The flow is authorization-code + PKCE (S256). Access tokens live six hours and are refreshed automatically; refresh tokens rotate on every use and are stored in the user's `oauth_tokens` row.

## User Setup

Go to **Data Sources → Gravl**. Two ways in, and the OAuth grant wins when both exist:

- **Personal access token.** Create one at [gravl.ai/developers/personal-tokens](https://gravl.ai/developers/personal-tokens) with the `workouts:read` scope and paste it into the token field. Works on any deployment, no admin involvement.
- **Connect Gravl (OAuth).** Available when the admin has configured an app. Click the button and grant access on Gravl.

Then **Sync Now**, or wait for the background poll.

## How Sync Works

- **REST:** `POST /api/sync/gravl` — `{ "full_resync": true, "start_date": "YYYY-MM-DD" }` optional. The result counts `workouts_processed` (real workouts seen), `activities_enriched` (Health Connect sessions that gained their sets) and `activities_created`; a re-processed Gravl row counts only as processed.
- **MCP:** `sync_gravl()`
- **Status:** `GET /api/sync/gravl/status`, `get_sync_status(provider: "gravl")`
- **Reset:** `DELETE /api/sync/gravl/state`

A run lists workouts in a window, removes Aurboda's own copy of the `External` ones (unless sets were logged onto them in Gravl, see [What is deliberately not imported](#what-is-deliberately-not-imported)) and the empty import of those without a logged set, fetches each real workout's detail (the list has no sets) and stores it. The window is 90 days on the first run or a full resync, otherwise from **two days before the last successful sync** — Gravl workouts get edited after the fact, and re-processing is idempotent.

The window is listed in 30-day chunks, oldest first, and each chunk is paged until a page comes back empty: Gravl's `hasNextPage` and `StartDate` have both been seen to under-deliver, ending the listing early or returning workouts outside the requested dates ([#1139](https://github.com/fiddur/aurboda/issues/1139)). A workout listed more than once in a run is handled once. A full resync therefore costs a few list requests more.

Removals of both kinds are reported in the audit log only; they do not change the three counters. Rows stored before this cleanup existed are cleared by the normal window as long as they fall inside it (two days before the last sync); older ones need a full resync — `POST /api/sync/gravl` with `"full_resync": true` (90 days, or from `start_date`).

**Rate limits:** 100 requests per 15 minutes per app + user. A run costs a couple of list pages per 30-day chunk (the last one empty) plus one detail request per workout (for an `External` one, only when it has two or more exercises or a positive volume). On a 429 the sync state records Gravl's `Retry-After` (or a 5-minute hold when the header is missing); later runs and Health Connect-triggered enrichments are skipped until it passes, and `last_sync_time` is not advanced so the same window is re-covered.

### Triggered by Health Connect

When the Android app uploads a Gravl session, the backend enqueues an enrichment job for that workout id. A minute later (retried with backoff if Gravl is still saving) the sets are attached — minute-scale latency instead of waiting for the poll. See [Health Connect → Source identity](./health-connect.md#source-identity). A later Health Connect re-delivery of a session whose row is tombstoned — an `External` round-trip's removed copy, or a session you deleted in Aurboda — is dropped without spending a Gravl API request, and the audit log says so. The exception is the retracted empty import of a set-less workout: it is fetched again, because you may have logged its sets since, and restored if so. Sets logged onto an `External` workout after its copy was removed arrive with the next poll instead.

### Background polling

Gravl is polled by the background scheduler together with the other pull-based sources. The interval is per user: **Data Sources → Gravl → Background sync interval** (or the default interval on the Data Sources page; the server fallback is 30 minutes). See [Data Sources → Sync Behavior](./data-sources.md#sync-behavior).

## Disconnecting

- OAuth: **Disconnect** on the Gravl page, or `POST /api/auth/gravl/disconnect`. The grant is revoked at Gravl (best effort) and cleared locally.
- Personal token: **Remove token** on the Gravl page, or set `gravl_api_token` to `null` in user settings.

Activities already imported are kept.
