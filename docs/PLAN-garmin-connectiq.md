# Plan: Aurboda Connect IQ watch app

Status: draft for discussion. Nothing here is implemented yet.

## Problem

Activities that have no Garmin sport (sex, and any custom Aurboda activity type) can only be
logged on the watch as something else (Yoga) and re-typed afterwards in Aurboda. Meditation
goes through the third-party [Meditate](https://github.com/floriangeigl/Meditate) app, whose
profiles, interval alerts and timers are not used. What is wanted is a watch app that shows
the Aurboda activity types the user has chosen, starts and stops a session, and gets HR and
stress at sample granularity into Aurboda.

## What already exists, and what that decides

- **Every Garmin activity is already imported.** `apps/backend/src/integrations/garmin/`
  pulls activities from Garmin Connect, keyed `garmin-activity-<id>`, and a second pass
  (`syncActivityDetails`) pulls the per-second chart data into `time_series`, mapping
  `directHeartRate` → `heart_rate` and `directCurrentStress` → `stress_level` through
  `DETAIL_METRIC_MAP` in `process.ts`. Connect IQ developer fields also arrive there, as
  `connectIQDeveloperField-NN` metric descriptors (see the fixtures in `process.test.ts`).
- **So the watch app does not need to upload samples.** A Connect IQ app that records a
  normal `ActivityRecording` session gets its FIT file synced to Garmin Connect by the
  Connect app, and Aurboda's existing importer does the rest. The watch needs no network
  during a session, and nothing is lost if the phone is out of reach.
- **The gap is the activity type.** FIT sport/sub-sport is a fixed enum, so `resolveActivityType`
  in `process.ts` can only map Garmin's `typeKey` onto Aurboda types by name. The app has to
  carry the Aurboda type through Garmin Connect some other way (see Decision 1).
- **Stress is not recorded natively during activities.** Garmin firmware computes stress in
  wellness mode; during a recorded activity `directCurrentStress` is usually absent. Meditate
  solves this by reading `ActivityMonitor.getInfo().stressScore` (the live 30 s score, newer
  devices) with `SensorHistory.getStressHistory()` as fallback, and writing it into the FIT
  file as a developer field. Aurboda's app does the same, and the importer maps that field.
- **Auth:** the REST API accepts the AES bearer token from `GET /api/auth/token` (the "Generate
  API Token" button, as ActivityWatch uses). A watch cannot run the OAuth/PKCE flow, so the
  token goes into the app's settings in the Garmin Connect phone app.
- **Repo:** `pnpm-workspace.yaml` covers `apps/*`, but Monkey C is not a Node package;
  `apps/android` is already the precedent for a non-Node app driven by root scripts and its own
  CI job.

## Decisions

### 1. How the Aurboda activity type travels: session name, then developer field

The app sets `createSession({ :name => <aurboda type name>, :sport, :subSport })`. Garmin
Connect shows a Connect IQ session's name as the activity name, and the importer already
stores `activityName` as the title. `resolveActivityType` gets a new first step: if the
activity name (lowercased) equals an `activity_type_definitions.name` or one of its
`aliases`, use that type. This is enough for phase 1 and needs no new plumbing.

Fallback if spike S1 shows Garmin Connect does not preserve the session name: write the
type as a FIT session-level developer field (`FitContributor`, `MESG_TYPE_SESSION`) and read
it from the activity summary JSON.

The Garmin sport/sub-sport is chosen per type so Garmin Connect's own stats stay sensible:
yoga → training/yoga (10/43), meditation → meditation (67), strength → training/strength
(10/20), everything else → generic. The mapping lives on the server (Decision 3), not in the
watch, so a new type never needs an app release.

### 2. Samples: HR natively, stress (and later HRV) as developer fields

- HR is recorded by the session automatically; the importer already maps it.
- Stress: a record-level developer field `stress` (score, 0..100), sampled every tick from
  `ActivityMonitor.getInfo().stressScore` when the device has it, else the newest
  `SensorHistory.getStressHistory()` sample. Field numbers are fixed by the app and documented
  in `docs/garmin-watch-app.md`.
- `DETAIL_METRIC_MAP` gains entries for the app's developer field numbers. Garmin only exposes
  the field number, not the app UUID, so the entries are gated: they apply only when the
  activity was resolved through the Aurboda app (Decision 1 matched the name, or the session
  marker field is present). That keeps Meditate's fields from being misread if both apps are
  installed.
- HRV (phase 3): `Sensor.registerSensorDataListener` with `heartBeatIntervals` at 1 s, RMSSD
  over a rolling window, written as a developer field and mapped to a `hrv_rmssd` series.

### 3. Configuration lives in Aurboda, the watch only fetches it

- `activity_type_definitions` gets two optional fields in `packages/api-spec`:
  `show_on_watch: boolean` and `fit_sport: { sport: number, sub_sport?: number }`. Both go
  through the existing `add_activity_type` / `update_activity_type` MCP tools and REST routes
  (parity is free because the schema is shared).
- New read endpoint `GET /api/activity-types/watch` (MCP: `list_watch_activity_types`) returns
  `[{ name, display_name, fit_sport }]` for the enabled types, ordered as the user wants, small
  enough for `makeWebRequest`'s response cap. The web `ActivityTypes` settings page gets a
  "show on watch" toggle and an order. The Android app embeds that page, so no native work.
- The watch fetches this list on app start when the phone is reachable, caches it in
  `Application.Storage`, and works from the cache when offline. The API token is an app
  setting (Garmin Connect app → Aurboda app → Settings). The token is non-expiring and
  unscoped today; a scoped watch token is a follow-up issue, not a blocker.

### 4. Not a Meditate fork, no profiles, no interval alerts

Meditate's SDK ceiling (4.1.5, type checker off) and its profile model are what we want to
leave behind. The app is written fresh against the current SDK with the type checker on,
borrowing Meditate's stress and HRV approach as reference. Interval buzzing, target
durations and breathing guidance are out of scope until someone wants them.

### 5. Repo layout and build

- `apps/garmin/`: `manifest.xml`, `monkey.jungle`, `source/`, `resources/`, `README.md`.
  Root scripts `build:garmin` and `test:garmin` wrapping `monkeyc`, mirroring the Android
  ones.
- CI: a `garmin` job in `ci.yml` behind a paths filter (`apps/garmin/**`), downloading and
  caching the Connect IQ SDK, building for the target device, running `Toybox.Test` unit
  tests in the simulator under Xvfb. A developer signing key is a repository secret; the
  built `.prg` is uploaded as an artifact for sideloading (`GARMIN/APPS` over USB).
- Devices: start with the one watch in use; broaden `products` in the manifest later.
  Store publication is a phase of its own.

## Spikes before phase 1

- **S1** Record a session from a throwaway Connect IQ app with `:name => "sex"` and sport
  generic. Confirm the name is what Garmin Connect returns as `activityName`, and check what
  `resolveActivityType` currently does with the resulting `typeKey`.
- **S2** In the same session, write one record-level developer field. Confirm it shows up in
  the details endpoint as `connectIQDeveloperField-NN` with the expected number.
- **S3** On the target watch, check that `ActivityMonitor.getInfo().stressScore` is non-null
  during a recorded session. If not, measure what `getStressHistory()` yields mid-session.

## Phases

### Phase 1: log an Aurboda type from the wrist

- `apps/garmin` skeleton, one device, manual list of types from an app-settings string
  (`sex,yoga,meditation`), a type picker, start/stop, session save.
- Backend: name/alias step in `resolveActivityType`, with tests in `process.test.ts`.
- Done when a session started as "sex" lands in Aurboda as a `sex` activity with an HR series,
  through the normal Garmin sync, with no manual re-typing.

### Phase 2: stress, and configuration from the server

- Developer field for stress; `DETAIL_METRIC_MAP` gated entries; tests with a fixture from S2.
- `show_on_watch` and `fit_sport` on activity type definitions; the watch list endpoint and
  MCP tool; the web toggle; `pnpm generate` for the Kotlin models.
- Watch fetches and caches the list; app-settings token.
- Docs: `docs/garmin-watch-app.md` (what is recorded, field numbers, setup), a row in
  `docs/data-sources.md`, a paragraph in `docs/garmin.md`.

### Phase 3: session feedback and HRV

- Live HR, elapsed time and stress on the session screen; a summary screen on stop.
- HRV from beat intervals as a developer field; `hrv_rmssd` mapping and summary metric.
- Optional immediate `POST /api/activities` from the watch at stop, so the activity appears
  in Aurboda before the Connect sync runs. The later Garmin import adopts it through
  `adoptLegacyActivity` on `(activity_type, start_time)`. Only worth it if the sync delay
  turns out to matter.

### Phase 4: ship

- CI job, more devices, store listing, and the scoped watch token.

## Out of scope

Meditation profiles, interval vibrations, target-duration timers, breathing programmes,
replacing the Garmin Connect import with direct upload from the watch.

## Open questions

- Which watch model, and its Connect IQ API level (decides `minApiLevel` and whether the live
  stress score exists).
- Should "sex" show in Garmin Connect as "Other" (sport generic), or as Yoga for continuity
  with past logging? Generic is the proposal.
- Sideload only for now, or aim for the store from the start (store needs the full
  `products` list and a review round).
