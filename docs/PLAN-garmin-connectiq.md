# Plan: Aurboda Connect IQ watch app

Status: draft for discussion. Nothing here is implemented yet.

The app is for any Aurboda user, on any Aurboda server: nothing about a particular user's
types, server or watch is baked in. The user points the app at their server, and everything
else it shows comes from their own account.

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

### 1. The title carries the Aurboda type; the Garmin sport is a per-type fallback

The app sets `createSession({ :name => <aurboda type>, :sport, :subSport })`. Garmin Connect
shows a Connect IQ session's name as the activity name, and the importer already stores
`activityName` as the title. `resolveActivityType` gets a new first step: if the activity
name, lowercased, equals an `activity_type_definitions` `name`, `display_name` or one of its
`aliases`, that type wins over the Garmin `typeKey`. Definitions are per user, so the match
is always against the user's own types. A Garmin-native activity titled "Running" resolves
to the same type either way, so the step is harmless for activities the app did not record.

Fallback if spike S1 shows Garmin Connect does not preserve the session name: write the
type as a FIT session-level developer field (`FitContributor`, `MESG_TYPE_SESSION`) and read
it from the activity summary JSON.

The Garmin sport/sub-sport recorded for a type is the user's choice, per type: "log sex as
Yoga" keeps Garmin Connect's history continuous with how it was logged before. Aurboda
supplies a default where a Garmin sport already maps onto the type (yoga → training/yoga
10/43, meditation → 67, strength → training/strength 10/20, the reverse of
`garminTypeKeyOverrides` and the built-in names) and generic (0/0) otherwise; the user can
change it. The choice is stored on the type definition (Decision 3), so the watch never
holds a sport table and a new type never needs an app release.

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

### 3. The watch pulls the user's types from Aurboda and the selection is made on the watch

Connect IQ has two places for configuration, and they suit different things:

- **App settings** (the settings page in the Garmin Connect phone app, declared statically in
  `resources/settings/`) hold what has to be typed: the Aurboda server URL (default
  `https://aurboda.net`) and the API token from "Generate API Token". A static page cannot
  show a list fetched from a server, so the type selection cannot live there.
- **On-watch menus** can. The app fetches the user's activity types from Aurboda
  (`makeWebRequest` through the phone) and shows them in a checkbox menu
  (`WatchUi.CheckboxMenu`, API 3.4+). The checked set is the picker for starting a session.

Concretely:

- `activity_type_definitions` gets one optional field in `packages/api-spec`,
  `fit_sport: { sport: number, sub_sport?: number }`, editable through the existing
  `update_activity_type` MCP tool and REST route and on the web `ActivityTypes` settings
  page (a sport picker with Garmin's names). The Android app embeds that page, so no native
  work. The web page is where the fallback sport is chosen; a picker per type on a watch
  screen is possible later, but a phone or browser is the better place for a one-time choice.
- The existing `GET /api/activity-types` (MCP `list_activity_types`) already returns every
  definition. The watch calls it with the token and keeps `name`, `display_name` and
  `fit_sport`. If the full list is too big for `makeWebRequest`'s response cap for users with
  many types, add a `fields` query parameter rather than a separate endpoint.
- The selection (which types the watch shows, and their order) is stored on the watch in
  `Application.Storage`, together with the cached list. Nothing on the server records what
  a watch shows, so a second watch or a reinstall means selecting again. That is the
  simplest generic design; a server-side `show_on_watch` can come later if syncing the
  selection across devices turns out to matter.
- The list is refreshed on demand from the menu ("Refresh types") and on app start when the
  phone is reachable; without the phone the app runs from the cache. First run without a
  cache and without the phone shows a message rather than an empty picker.
- The token is non-expiring and unscoped today; a scoped, revocable watch token is a
  follow-up issue, not a blocker.

### 4. Not a Meditate fork, no profiles, no interval alerts

Meditate's SDK ceiling (4.1.5, type checker off) and its profile model are what we want to
leave behind. The app is written fresh against the current SDK with the type checker on,
borrowing Meditate's stress and HRV approach as reference. It starts with only what will be
used: pick a type, start, stop, save. Interval buzzing, target durations and breathing
guidance are out of scope until someone wants them.

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

- **S1** Record a session from a throwaway Connect IQ app with `:name => "Sex"` and sport
  training/yoga. Confirm the name is what Garmin Connect returns as `activityName` (and that
  Connect does not rename it after the sport), and note the `typeKey` it reports.
- **S0** Confirm `makeWebRequest` from the watch reaches the user's Aurboda with a bearer
  header and receives `GET /api/activity-types` within the response size cap.
- **S2** In the same session, write one record-level developer field. Confirm it shows up in
  the details endpoint as `connectIQDeveloperField-NN` with the expected number.
- **S3** On the target watch, check that `ActivityMonitor.getInfo().stressScore` is non-null
  during a recorded session. If not, measure what `getStressHistory()` yields mid-session.

## Phases

### Phase 1: log an Aurboda type from the wrist

- `apps/garmin` skeleton, one device. App settings for server URL and token. Fetch the
  user's types, checkbox menu to select which to show, cached in Storage, a picker, start,
  stop, save. Sport from `fit_sport`, generic when unset.
- api-spec: `fit_sport` on activity type definitions, `pnpm generate` for the Kotlin models;
  the web `ActivityTypes` page gets the sport picker.
- Backend: name/alias step in `resolveActivityType`, with tests in `process.test.ts`, and
  defaults for `fit_sport` on built-in types.
- Done when a session started as "Sex" (recorded as Yoga) lands in Aurboda as a `sex`
  activity with an HR series, through the normal Garmin sync, with no manual re-typing.

### Phase 2: stress

- Developer field for stress; `DETAIL_METRIC_MAP` gated entries; tests with a fixture from S2.
- Docs: `docs/garmin-watch-app.md` (setup, what is recorded, field numbers), a row in
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

- Which watch model to start with, and its Connect IQ API level (decides `minApiLevel`,
  whether `CheckboxMenu` and the live stress score exist).
- Sideload only for now, or aim for the store from the start (store needs the full
  `products` list and a review round). Generic for any user argues for the store eventually.
- Session names: Garmin suggests at most 15 characters. Use `display_name` for readability
  in Connect and match on it, or `name` for safety? Proposal: `display_name`, truncated,
  with `name` as the match fallback.
