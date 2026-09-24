# Plan: Aurboda Connect IQ watch app

Status: draft for discussion. Nothing here is implemented yet.

The app is for any Aurboda user, on any Aurboda server: nothing about a particular user's
types, server or watch is baked in. The user points the app at their server, and everything
it shows comes from their own account.

## Problem

Activities that have no Garmin sport (sex, and any custom Aurboda activity type) can only be
logged on the watch as something else (Yoga) and re-typed afterwards in Aurboda. Meditation
goes through the third-party [Meditate](https://github.com/floriangeigl/Meditate) app, whose
profiles, interval alerts and timers are not used. What is wanted is a watch app that shows
the Aurboda activity types the user has chosen, in the order they chose, starts and stops a
session, and gets HR and stress at sample granularity into Aurboda.

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
  carry the Aurboda type through Garmin Connect some other way (Decision 1).
- **Stress is not recorded natively during activities.** Garmin firmware computes stress in
  wellness mode; during a recorded activity `directCurrentStress` is usually absent. Meditate
  solves this by reading `ActivityMonitor.getInfo().stressScore` (the live 30 s score, newer
  devices) with `SensorHistory.getStressHistory()` as fallback, and writing it into the FIT
  file as a developer field. Aurboda's app does the same, and the importer maps that field.
- **Auth:** the REST API accepts the AES bearer token from `GET /api/auth/token` (the "Generate
  API Token" button, as ActivityWatch uses). A watch cannot run the OAuth/PKCE flow, so the
  token goes into the app's settings in the Garmin Connect phone app.
- **User settings already hold ordered configuration lists.** `mealSlotsSchema` in
  `packages/api-spec/src/schemas/settings.ts` is an array of configured slots inside
  `updateSettingsInputSchema`, read and written by `GET/PUT /api/settings` and the
  `get_user_settings` / `update_user_settings` MCP tools. The watch configuration follows
  that pattern, so REST, MCP and the Android app (which embeds the web settings page) get it
  without extra plumbing.
- **Repo:** `pnpm-workspace.yaml` covers `apps/*`, but Monkey C is not a Node package;
  `apps/android` is already the precedent for a non-Node app driven by root scripts and its own
  CI job.

## Decisions

### 1. Aurboda owns the mapping, in both directions

A new user setting, `garmin_watch_types`, is an ordered list:

```
{ activity_type: string, session_name: string, fit_sport: number, fit_sub_sport: number }
```

- `activity_type` is the Aurboda type to log.
- `session_name` is what the watch passes as `:name` to `createSession` and what Garmin
  Connect shows as the activity title. Default: the type's `display_name`, cut to Garmin's
  suggested 15 characters. The user can change it. Names are unique within the list.
- `fit_sport` / `fit_sub_sport` is the Garmin sport the session is recorded as, so Garmin
  Connect's own history stays sensible: "log sex as Yoga" keeps continuity with how it was
  logged before. Aurboda suggests a default where a Garmin sport already maps onto the type
  (yoga → training/yoga 10/43, meditation → 67, strength → training/strength 10/20, the
  reverse of `garminTypeKeyOverrides` and the built-in names) and generic (0/0) otherwise.

Outbound, the watch fetches this list and shows exactly it, in this order (Decision 3).
Inbound, `resolveActivityType` in `process.ts` gets a first step: if the imported activity's
`activityName` equals a `session_name` in the user's list (case-insensitive), that entry's
`activity_type` wins over the Garmin `typeKey`, and the activity is marked in `data` as
watch-recorded (`garmin_watch_session: true`). Everything else resolves as today. The match is
against the user's own list, so it is per user, and an activity whose title happens to equal
a session name resolves the way the user configured it, which is what they asked for.

Fallback if spike S1 shows Garmin Connect does not preserve the session name: write the
list entry's `activity_type` as a FIT session-level developer field (`FitContributor`,
`MESG_TYPE_SESSION`) and read it from the activity summary JSON. The setting stays the same.

### 2. Samples: HR natively, stress (and later HRV) as developer fields

- HR is recorded by the session automatically; the importer already maps it.
- Stress: a record-level developer field `stress` (score, 0..100), sampled every tick from
  `ActivityMonitor.getInfo().stressScore` when the device has it, else the newest
  `SensorHistory.getStressHistory()` sample. Field numbers are fixed by the app and documented
  in `docs/garmin-watch-app.md`.
- `DETAIL_METRIC_MAP` gains entries for the app's developer field numbers. Garmin only exposes
  the field number, not the app UUID, so the entries apply only to activities Decision 1
  marked as watch-recorded. That keeps Meditate's fields from being misread if both apps are
  installed.
- HRV (phase 3): `Sensor.registerSensorDataListener` with `heartBeatIntervals` at 1 s, RMSSD
  over a rolling window, written as a developer field and mapped to a `hrv_rmssd` series.

### 3. The watch is a thin client of that setting

Connect IQ has two places for configuration:

- **App settings** (the page in the Garmin Connect phone app, declared statically in
  `resources/settings/`) hold what has to be typed: the Aurboda server URL (default
  `https://aurboda.net`) and the API token from "Generate API Token".
- **Everything else comes from Aurboda.** The watch calls a small read endpoint,
  `GET /api/garmin-watch/config` (MCP `get_garmin_watch_config`), which returns the
  `garmin_watch_types` list with each type's `display_name` resolved. That is small enough for
  `makeWebRequest`'s response cap for any realistic list, unlike the full settings or the full
  activity type list. The watch caches it in `Application.Storage`, refreshes on app start when
  the phone is reachable and on demand from the menu, and runs from the cache when offline.
  First run without a cache and without the phone shows a message rather than an empty picker.
- The watch keeps no configuration of its own beyond the cache. A second watch or a reinstall
  shows the same list.

The web settings page gets a **Garmin watch** section: the ordered list with add, remove and
reorder, and per row a type picker, the session name (validated to 15 characters, unique),
and a Garmin sport picker showing Garmin's names. The Android app embeds the settings page,
so no native work. `apps/android` is only touched by `pnpm generate` for the Kotlin models.

The token is non-expiring and unscoped today; a scoped, revocable watch token is a follow-up
issue, not a blocker.

### 4. Not a Meditate fork, no profiles, no interval alerts

Meditate's SDK ceiling (4.1.5, type checker off) and its profile model are what we want to
leave behind. The app is written fresh against the current SDK with the type checker on,
borrowing Meditate's stress and HRV approach as reference. It starts with only what will be
used: pick a type, start, stop, save. Interval buzzing, target durations and breathing
guidance are out of scope until someone wants them.

### 5. Devices, distribution, repo layout

- **First device: Forerunner 255** (firmware 29.05). The SDK's device definition gives its
  Connect IQ API level; it is a 4.x-era device, so `CheckboxMenu`, `SensorHistory` stress and
  `FitContributor` are available. Whether `ActivityMonitor.Info.stressScore` is non-null
  during a recorded session on it is spike S3. `minApiLevel` in the manifest is set to what
  the FR255 reports, and `products` lists only `fr255` until phase 4.
- **Sideloading first, store later.** A developer key signs the `.prg`, which is copied to
  `GARMIN/APPS` over USB. The store needs the full `products` list, store assets and a review
  round; it is phase 4, and the code is written from the start as if it will be published
  (no debug-only shortcuts, settings with sensible defaults, a server URL that is not
  assumed to be aurboda.net).
- `apps/garmin/`: `manifest.xml`, `monkey.jungle`, `source/`, `resources/`, `README.md`.
  Root scripts `build:garmin` and `test:garmin` wrapping `monkeyc`, mirroring the Android
  ones.
- CI: a `garmin` job in `ci.yml` behind a paths filter (`apps/garmin/**`), downloading and
  caching the Connect IQ SDK, building for `fr255`, running `Toybox.Test` unit tests in the
  simulator under Xvfb. The developer signing key is a repository secret; the built `.prg` is
  uploaded as an artifact for sideloading.

## Spikes before phase 1

- **S0** Confirm `makeWebRequest` from the FR255 reaches the user's Aurboda with a bearer
  header and receives a small JSON response.
- **S1** Record a session from a throwaway Connect IQ app with `:name => "Sex"` and sport
  training/yoga. Confirm the name is what Garmin Connect returns as `activityName` (and that
  Connect does not rename it after the sport), and note the `typeKey` it reports.
- **S2** In the same session, write one record-level developer field. Confirm it shows up in
  the details endpoint as `connectIQDeveloperField-NN` with the expected number.
- **S3** On the FR255, check that `ActivityMonitor.getInfo().stressScore` is non-null during
  a recorded session. If not, measure what `getStressHistory()` yields mid-session.

## Phases

### Phase 1: log an Aurboda type from the wrist

- api-spec: `garmin_watch_types` in the settings schemas, the config response schema,
  `pnpm generate` for the Kotlin models.
- Backend: the setting in `settings-router.ts` and the settings MCP tools (validation:
  known types, unique names, 15 characters); `GET /api/garmin-watch/config` and
  `get_garmin_watch_config`; the session-name step in `resolveActivityType` with the
  watch-recorded marker, tested in `process.test.ts`; default `fit_sport` suggestions for
  built-in types.
- Web: the Garmin watch section on the settings page.
- `apps/garmin` skeleton for `fr255`: app settings for server URL and token; fetch and cache
  the config; a picker in the configured order; start, stop, save with the entry's session
  name and sport.
- Done when a session started as "Sex" (recorded as Yoga) lands in Aurboda as a `sex`
  activity with an HR series, through the normal Garmin sync, with no manual re-typing.

### Phase 2: stress

- Developer field for stress; gated `DETAIL_METRIC_MAP` entries; tests with a fixture from
  S2.
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

- CI job, more devices in `products`, store assets and listing, and the scoped watch token.

## Out of scope

Meditation profiles, interval vibrations, target-duration timers, breathing programmes,
replacing the Garmin Connect import with direct upload from the watch, configuring anything
on the watch itself beyond the server URL and token.

## Open questions

- Does a title-only match need a guard? A user who titles a manual Garmin activity with one
  of their session names gets it typed accordingly. The proposal treats that as intended; a
  session-level developer field marker (the S1 fallback) would make it strict if wanted.
- Where the Garmin sport picker's list of names comes from: a curated constant in api-spec
  (sport and sub-sport codes with labels), since the FIT profile is large and mostly
  irrelevant here. Proposal: start with the sports Garmin Connect itself offers for manual
  activities.
