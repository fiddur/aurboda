# Garmin Connect

[Garmin Connect](https://connect.garmin.com/) provides fitness and health data from Garmin wearable devices (watches, fitness trackers). Aurboda reaches it in three ways, alone or together:

- **Connect with Garmin**: the official [Garmin Connect Developer Program](https://developer.garmin.com/gc-developer-program/overview/) (OAuth 2.0 with PKCE). The user signs in at Garmin and picks what to share; Garmin then pushes new data to the server as the user's device syncs. It cannot pull, so it brings no history. See [Connect with Garmin](#connect-with-garmin).
- **The Garmin Connect login** ("the session"): the Garmin Connect web API, reached with [`@fiddur/garmin-connect`](https://www.npmjs.com/package/@fiddur/garmin-connect), our [fork](https://github.com/fiddur/garmin-connect) of `@flow-js/garmin-connect` with two-step MFA login.
- **A Personal API key**: Garmin's official [Personal API](https://developer.garmin.com/gc-developer-program/overview/) at `personal.connectapi.garmin.com`, which any Garmin Connect user can create a key for. It is pull only, like the session, and covers most but not all of what the session does.

## The two pull connections

Each data type is pulled through one connection, the login or the key; Connect with Garmin takes no part in the pull sync, but once it delivers a type the automatic pull leaves that type to it (see [When Connect with Garmin delivers a type](#when-connect-with-garmin-delivers-a-type)):

| Data type          | Login only | Key only                | Both                              |
| ------------------ | ---------- | ----------------------- | --------------------------------- |
| Daily summary      | Login      | Key                     | Key                               |
| Heart rate         | Login      | Key                     | Key                               |
| HRV                | Login      | Key                     | Key                               |
| Sleep              | Login      | Key (no stage timeline) | Login (it has the stage timeline) |
| Body Battery       | Login      | Key                     | Key                               |
| SpO2               | Login      | Key                     | Key                               |
| Respiration        | Login      | Key (from the summary)  | Key                               |
| Intensity minutes  | Login      | Key (from the summary)  | Key                               |
| Activities         | Login      | Key                     | Key                               |
| Activity details   | Login      | Key (the FIT file)      | Key (the FIT file)                |
| Exercise sets      | Login      | Key (the FIT file)      | Login (it replaces the FIT's)     |
| Stress             | Login      | Skipped                 | Login                             |
| Training readiness | Login      | Skipped                 | Login                             |

With a key and no login, stress and training readiness are skipped (no sync state is written for them), sleep comes without the stage timeline (a Health Connect timeline already on the night is kept), and activities' per-second detail, GPS track and [strength sets](#strength-sets) come from the [activity's FIT file](#activity-detail-from-the-fit-file). A key that is refused or past its expiry date is not used, and the session, if any, serves every type instead: a refused key is tried again once a day (see below), and a key is used through its expiry date and not from the next day (UTC), without a request to Garmin. When the key serves a type and the Personal API answers a `5xx` (or fails on the network), the sync records an error for that type and day rather than asking the login; the next run tries the key again.

Respiration and intensity minutes come from the key's daily summary (`avgWakingRespirationValue`, `moderateIntensityMinutes`, `vigorousIntensityMinutes`, `intensityMinutesGoal`), which is fetched once per day for all three types and kept for 60 seconds; connecting or disconnecting a key drops the user's copy, so a replaced key answers at once.

## When Connect with Garmin delivers a type

A user with the login (or a key) and Connect with Garmin would otherwise get every type fetched twice. Once Connect with Garmin **delivers** a data type, the **automatic** pull (the background poll, the top-up before a query, and the Health Connect enrichment job) stops fetching it; the login and the key keep fetching everything else (`apps/backend/src/integrations/garmin/push-coverage.ts`). A type counts as delivered when all of these hold:

1. Connect with Garmin is connected and does not need a reconnect.
2. Garmin pushed something for the user (any `garmin_push` sync state, whatever its status) less than 24 hours ago.
3. A push type that carries the data type was last processed without error (its `garmin_push` state is `idle`). `pulseox`, `allDayRespiration` and `activities` may be older than 24 hours: a user can go a week without an activity. The types that arrive every day (`dailies`, `sleeps`, `hrv`, `stressDetails`) vouch only while their own last push is at most three days old (`GARMIN_DAILY_PUSH_STALE_MS`): if Garmin stops sending one of them while the others keep coming, the automatic pull takes back the data types it carries after three days.
4. The user shares the permission it needs: `ACTIVITY_EXPORT` for activities, `HEALTH_EXPORT` for the rest. When Garmin's permission answer could not be read (an empty permission list), this rule is left out and the first three decide.

| Push type           | Delivers                                     |
| ------------------- | -------------------------------------------- |
| `dailies`           | Daily summary, heart rate, intensity minutes |
| `sleeps`            | Sleep                                        |
| `hrv`               | HRV                                          |
| `stressDetails`     | Stress, Body Battery                         |
| `pulseox`           | SpO2                                         |
| `allDayRespiration` | Respiration                                  |
| `activities`        | Activities                                   |

`activityDetails`, `activityFiles` and `manuallyUpdatedActivities` do not vouch for activities, and training readiness is never delivered, so the login keeps fetching it, as it keeps fetching [strength sets](#strength-sets).

When the automatic pull leaves a type to the push, it writes that type's `garmin` sync state as `idle` with the current time (unless a manual sync holds it as `syncing`), so the interval holds and a later pull resumes from there; no `Auto-syncing Garmin <type>` audit entry is written and nothing is fetched. For activities the detail step still runs, but an activity under a day old is left for its pushed FIT file, which is the full recording (the login's JSON detail would mark it done first); older activities get their detail from the login or the key as before.

A **manual** sync (`POST /api/sync/garmin`, MCP `sync_garmin`, **Sync now** and **Full Re-sync**) is unchanged and fetches everything the login or the key serves, including history: that is how a user refills. When the pushes stop for 24 hours, the grant needs a reconnect, or the user stops sharing a permission, the automatic pull takes the types back by itself.

Settings report the delivered types as `garmin_oauth.delivers`, and, for each data type, the connection that brings it as `garmin_data_sources`: `push` where Connect with Garmin delivers it, else the pull connection the sync would use for it (`session` for the login, `personal_key` for the key: a key serves every type it covers except sleep when a login also exists); a type nothing brings is left out. Once Connect with Garmin delivers something, the Garmin page shows that under each data type ("Delivered by Connect with Garmin", "Fetched through the Garmin login", "Fetched with the Personal API key").

## Data Synced

| Garmin Data Type   | Stored As              | Metrics                                                                                                                                  |
| ------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Daily Summary      | time_series            | `steps`, `distance`, `floors_climbed`, `calories_active`, `calories_total`, `resting_heart_rate`, `stress_level`, `spo2`                 |
| Heart Rate         | time_series            | `heart_rate` (individual samples from heartRateValues)                                                                                   |
| HRV                | time_series            | `hrv_rmssd` (last night average)                                                                                                         |
| Sleep              | activity + time_series | Sleep activity with stages and durations; `sleep_score`, `resting_heart_rate`, `hrv_rmssd`, `heart_rate` (sleep HR)                      |
| Stress             | time_series            | `stress_level` (overall daily stress)                                                                                                    |
| Body Battery       | time_series            | `body_battery` (from values array or daily charged amount)                                                                               |
| Activities         | activity + time_series | Exercise activities with type, distance, calories, HR, VO2 max; `vo2_max`                                                                |
| Activity Details   | time_series + track    | Per-second `heart_rate`, `respiratory_rate`, `speed`, `elevation`, … and GPS — see [Activity detail](#activity-detail-from-the-fit-file) |
| Exercise Sets      | activity data          | `data.sets` of Garmin strength activities: exercise, reps, weight (kg), time (s) — see [Strength sets](#strength-sets)                   |
| SpO2               | time_series            | `spo2` (average daily blood oxygen)                                                                                                      |
| Respiration        | time_series            | `respiratory_rate` (average waking respiration)                                                                                          |
| Training Readiness | time_series            | `training_readiness` (the latest entry's `score`)                                                                                        |
| Intensity Minutes  | time_series            | `intensity_minutes` (`moderateMinutes` + `vigorousMinutes`×2)                                                                            |

All data is also preserved as raw JSON in the `raw_records` table. HRV is read from the answer's `hrvSummary` (the 5-minute `hrvReadings` are not ingested). Training readiness has not been seen from Garmin yet: its raw record (`garmin_training_readiness`, an array answer kept as `{ "entries": [...] }`) is written before anything is read, and both an array of entries with `score` and a single object with `overallScore` are read. When the HRV, training readiness or intensity minutes processor cannot place a payload, it keeps the raw record under the requested day and writes a `warn` audit entry naming the data type and the payload's keys, so a changed shape shows up instead of being dropped; a day with no data (an empty answer or one of nulls) is skipped without a warning.

> **Note on `calories_active` and `calories_total`:** these metrics are stored from Garmin's daily summary (source `garmin`) but **excluded from queries** — aurboda recomputes them per-minute from HR data using the zone-METs model and is the authoritative source for both metrics. See [`docs/features/calories.md`](./features/calories.md) for the model and the source-filter rationale.

## Activity detail from the FIT file

An activity's per-second detail comes from one of two places:

- **The FIT file** (a usable Personal API key, with or without a login): `GET /download-service/files/activity/{activityId}` serves the activity's original recording as a ZIP. It wins over the JSON detail whenever the key is usable, as it is the full recording, where the JSON is a chart downsampled to at most 10000 points and a 4000-point polyline.
- **The JSON detail** (the login, when no key is usable): `GET /activity-service/activity/{activityId}/details`.

From the file's `record` messages (several `.fit` entries in one ZIP are merged in time order) Aurboda writes, at each record's own timestamp and with the same metric names, units and `source` as the JSON detail, so the two are interchangeable downstream:

| FIT `record` field                                   | Metric                 | Unit    |
| ---------------------------------------------------- | ---------------------- | ------- |
| `heart_rate`                                         | `heart_rate`           | bpm     |
| `enhanced_respiration_rate`, else `respiration_rate` | `respiratory_rate`     | brpm    |
| `enhanced_speed`, else `speed`                       | `speed`                | m/s     |
| `enhanced_altitude`, else `altitude`                 | `elevation`            | m       |
| `power`                                              | `power`                | W       |
| `vertical_speed`                                     | `vertical_speed`       | m/s     |
| `stance_time`                                        | `ground_contact_time`  | ms      |
| `vertical_oscillation` (mm)                          | `vertical_oscillation` | cm      |
| `vertical_ratio`                                     | `vertical_ratio`       | percent |
| `step_length` (mm)                                   | `stride_length`        | m       |
| `current_stress`                                     | `stress_level`         | score   |
| `cadence` + `fractional_cadence`, doubled            | `run_cadence`          | spm     |

`run_cadence` is written only for running, walking and hiking, where the FIT cadence counts strides. Body Battery, grade-adjusted speed and performance condition have no `record` field in the FIT profile, so a FIT-synced activity has none of them. Only profile fields are read: developer fields, and anything Garmin leaves out of the file, are ignored. Positions (semicircles in the file) become degrees; a record without a position or at `0,0` gives no GPS point. Every positioned record is a GPS point in `locations` (taking [precedence](./data-sources.md#gps-precedence) over other sources across the activity) and a point of the activity's track (`activity_tracks`, `source` `garmin`, full resolution, altitude from the enhanced altitude), the same track row the JSON detail writes.

The raw record is a compact summary only (`garmin_activity_fit`, `external_id` `garmin-activity-fit-<activityId>`): the file's `file_id`, `session`, `lap`, `set` and `exercise_title` messages (without developer fields) and the record count. The file and its records are not stored. The [track backfill](./features/routes-and-segments.md) reads only stored JSON details (`garmin_activity_detail`); a FIT-synced activity already has its track, and is not a backfill candidate.

When Garmin has no usable file for an activity (a `404`, a ZIP without a readable `.fit` entry, a file failing its integrity check, or one over 50 MB, or an entry over 100 MB unpacked): with a login, that activity's JSON detail is used instead; without one, an activity that started less than 24 hours ago is left as it is and asked for again on the next run (Garmin can list an activity before it serves its file), and an older one is marked as having its detail (a manual activity has no file to wait for) and the audit log says so. Any other failure (the network, a `5xx`, a refused key or download, or a ZIP whose `.fit` entries add up to more than 400 MB unpacked, which is refused before unpacking further): with a login, that activity's JSON detail is used instead and the audit log has a warning with the error; without one, the activity is left for the next run and the audit log has the error. A full re-sync downloads the file of every activity again, and the files are larger than the JSON detail. For an activity synced through its JSON detail before, the file's samples replace the `garmin` samples that detail wrote: the old ones of the metrics the file carries, over the activity's span, are deleted in the same transaction that writes the new ones (a metric only the JSON detail has, like `body_battery`, stays). The file's strength sets are read as described under [Strength sets](#strength-sets); laps and swim lengths are not read from the file.

## Activity Type Mapping

Garmin labels each activity with a `typeKey` (e.g. `running`, `indoor_rowing`, `rowing_v2`). It is resolved to an aurboda activity type in this order:

1. **Override map** — Garmin names that differ from the Health Connect exercise names used in `@aurboda/api-spec` (e.g. `treadmill_running` → `running_treadmill`, `indoor_rowing` → `rowing_machine`, `breathwork` → `meditation`). Aligning the names keeps cross-source merging working.
2. **Version suffix stripped** — Garmin revises sport keys in place and marks them with a version suffix, so `rowing_v2` resolves as `rowing` and `indoor_rowing_v2` goes through the override map as `indoor_rowing`.
3. **Fallback** — if the resulting name has no row in `activity_type_definitions`, the activity is stored as `other_workout` with the original key kept in `data.garmin_type_key`. Without this, an unrecognized sport would violate the `activities.activity_type` foreign key and abort the rest of the batch.

A custom activity profile made on the watch (a copy of a built-in profile with a new name) is reported by Garmin as its base sport — a copy of "Other" arrives as `other`, stored as `other_workout`. The profile name only survives in the title, which Garmin prefixes with the place for GPS activities ("Mark Sex"). A [retype deduction rule](./features/deduction-rules.md#retype-mode) matching on the title turns these into the aurboda type you want.

A degraded type is recorded in the audit log as a warning (once per distinct key per sync), so new Garmin sports surface there rather than only in `data.garmin_type_key`. A failure on one activity is logged as an error and does not stop the remaining activities in the batch.

Garmin's sync sets the type and title of an activity that also arrives through Health Connect, and the Health Connect copy no longer replaces them (see [Health Connect → Source identity](./health-connect.md#source-identity)). Rows that a Health Connect copy turned into a generic `exercise` without a title before that rule ([#1831](https://github.com/fiddur/aurboda/issues/1831)) get Garmin's type and title back with a **Full Re-sync**.

## GPS

Activity GPS comes from the activity's FIT file through a usable key, else from the activity detail API (see [Activity detail](#activity-detail-from-the-fit-file)), every sample kept (`geoPolylineDTO` is the fallback when the JSON detail's per-second metrics carry no coordinates). It supersedes coarser tracking from other sources (e.g. OwnTracks phone positions) for the activity's whole span -- see [GPS Precedence](./data-sources.md#gps-precedence).

The same samples, with the altitude (`enhanced_altitude` in the file, `directElevation` in the JSON), are also written as the activity's track in `activity_tracks` -- see [Routes and segments](./features/routes-and-segments.md). Activities synced before tracks existed get theirs from the stored JSON detail by the track backfill.

## Strength sets

Garmin strength activities (`strength_training` rows from Garmin with a `garmin_activity_id`) get the sets the watch recorded, on every connection:

- **Through the login**, from `GET /activity-service/activity/{activityId}/exerciseSets`.
- **From the activity's FIT file**, when the detail comes from the file: through a Personal API key (the [FIT file](#activity-detail-from-the-fit-file)) or pushed by Connect with Garmin (its [activity files](#activity-files)). The file's `set` messages are read; its `exercise_title` messages name custom exercises.

Where both exist the login's result wins: the FIT file's sets are written only on a row the login's reader has not written yet, and the login's reader still visits a row that has FIT sets and replaces them with its own. A strength activity whose detail was synced before sets were read from the file gets them only on a **Full Re-sync**, which reads every file again; there is no backfill.

- **Naming.** Through the login, each set's exercise is the one Garmin rates most probable; in the FIT file, it is the set's first category that is not `unknown`, with its subtype, spelled as the catalogue's FIT keys are (`pullUp` / `30DegreeLatPulldown` is `pull_up/_30_degree_lat_pulldown`). Its FIT key (`<category>/<name>`) is looked up in the [exercise catalogue](./features/exercise-catalog.md) (`same_as.fit`); a known key names the set by the catalogue entry, and your own name for that entry wins over the catalogue's, as for any set written by catalogue key. A key the catalogue does not know is stored under Garmin's name in title case (`45_DEGREE_PLANK` becomes `45 Degree Plank`) and is listed as unmapped, to map like any other name. From the FIT file, a key the catalogue does not know takes the step name of the matching `exercise_title` message when there is one (a custom exercise), before Garmin's name. A set with only a category uses the category's generic entry where there is one (`squat/squat`), else the category's name; no category, or `UNKNOWN`, gives `Unknown exercise`. Your aliases are applied as well.
- **Values.** Reps; weight in kg (the login's response is in grams, the FIT file's in kg); and for a set without reps, its duration in seconds as `time`. Rest sets, and sets with neither reps nor time, are skipped.
- **Storage.** The sets go to `data.sets` with `data.sets_source: 'garmin'`. The login's reader sets `data.garmin_sets_synced`, marking the activity read also when it had no sets, and keeps the raw response as a `garmin_exercise_sets` raw record; a failed read leaves the activity for the next sync. Sets from the FIT file also carry `data.garmin_sets_origin: 'fit'`, which the login's write removes; they do not set `garmin_sets_synced`, and a file without active sets writes nothing. A FIT set that cannot be named is audited and leaves the activity without FIT sets; the detail is written all the same.
- **Pace.** Through the login, each sync reads the sets of up to 10 activities, newest first, before their detail, so older strength activities fill in gradually over the following syncs. `full_resync` re-reads the newest 10.
- **Sets logged elsewhere win.** When a session logged in Aurboda, Gravl or a manual log carries sets for the same session, those are the sets shown: sets imported from Garmin never replace sets from another row in a [merge](./gravl.md#enrich-dont-duplicate), whichever row starts first. Garmin's sets show only when no other row of the session has any. The rule holds everywhere a merged session is shown or written: the day and list views, the activity page, the shared post and the manual merge.

## Connect with Garmin

Connect with Garmin uses the Garmin Connect Developer Program's OAuth 2.0 authorization-code flow with PKCE (`apps/backend/src/integrations/garmin/oauth-client.ts`). It needs an app registered in the program by the server's admin (see [Admin Setup](#admin-setup)).

**What it does.** It makes the connection (the OAuth round trip, the Garmin user id mapping, the status on the Garmin page, token upkeep and disconnect), and the data then arrives by Garmin's pushes: see [Data pushed by Garmin](#data-pushed-by-garmin). The pull sync, its data types and its sync states are unchanged and run only on the login and the key.

**The round trip.** **Connect with Garmin** on the Garmin page calls `GET /api/auth/garmin/oauth/connect`, which answers `{ success: true, url }` (or `400` when the server has no credentials) and the page sends the browser to Garmin's consent screen (`https://connect.garmin.com/oauth2Confirm`). There is no scope parameter: the app's scope is fixed in the program, and the user picks which permissions to grant on the consent screen. The PKCE verifier and the user travel in the `state` parameter, sealed with AES-256-GCM under a key derived from the client secret and valid for ten minutes (`apps/backend/src/services/oauth-state.ts`, shared with Gravl). It finishes in two steps, because Garmin's redirect carries no Aurboda login:

1. **Hand-over.** Garmin redirects to `GET /api/auth/garmincb`, which links nothing. It checks that the state opens and redirects to `/data-sources/garmin?garmin_code=<code>&garmin_state=<state>`, or to `/data-sources/garmin?error=<code>` with `auth_failed` (Garmin answered an error, or no code or state, or one of them repeated), `not_configured` or `invalid_state`.
2. **Completion by the signed-in page.** The Garmin page removes the two parameters from the address (so a reload does not replay a used code) and sends them to `POST /api/auth/garmin/oauth/complete` (`{ code, state }`, behind the login). The endpoint refuses unless the signed-in user is the user sealed in the state: a sign-in started from another Aurboda account answers `403`, is audited on the signed-in user only, and nothing is sent to Garmin, so a consent link passed to someone else cannot link their Garmin account to the account that started it. Otherwise it exchanges the code, reads the Garmin user id (`GET https://apis.garmin.com/wellness-api/rest/user/id`, required: without it nothing is stored) and the granted permissions (`.../user/permissions`, best effort), stores the grant and answers `{ success: true }`. An expired or tampered state, a server without credentials and a failed exchange answer `400` with a message the page shows.

A user who started in the Android app consents in the phone's browser, so the connection finishes in that browser, which must be signed in to the same Aurboda account. Without a login there the page offers **Log in to finish connecting Garmin**, which comes back to the page after the login.

**Storage.** The grant is a row in the user's `oauth_tokens` (provider `garmin_oauth`): the access token, the refresh token, `expires_at`, and the granted permissions in `scopes` (`HEALTH_EXPORT`, `ACTIVITY_EXPORT`, `MCT_EXPORT`, `WORKOUT_IMPORT`, `COURSE_IMPORT`). The Garmin user id, which every push carries, maps to the Aurboda user in the central `garmin_user_mappings` table. One Garmin account belongs to one Aurboda user: connecting a Garmin account that another Aurboda user had connected moves it, deletes the other user's grant and audits it on both. A user who reconnects with a different Garmin account drops the old mapping, and the old account is deregistered at Garmin (best effort). If the mapping cannot be written, the grant just stored is removed again, so a connection never shows as connected without it. No token, code, verifier, client secret or Garmin user id reaches a response, an audit entry or a log line. When the permissions could not be read at connect (the request failed, audited as a warning, or its answer was not understood, audited by its shape only), the grant is stored with no permissions, and the scheduler's token upkeep reads them again at most once an hour until Garmin answers some, storing them as a permission-change notice would.

**Token upkeep.** An access token lasts 24 hours and is refreshed when less than 600 seconds of it are left, as Garmin recommends; each refresh brings a new refresh token (rotation), which lasts about three months. Concurrent callers on one server share one refresh. A refresh Garmin answers with the OAuth error `invalid_grant` marks the grant refused (`oauth_tokens.refused_at`): it is not refreshed again, and the page asks the user to connect again. Any other failure, a rejected client secret included, leaves the grant as it is. Since a user whose data only arrives by push would otherwise never refresh, the five-minute background sync tick refreshes every grant that is due, so the refresh token does not lapse; a failure there is audited as a warning and that user is tried again an hour later.

**Status.** Settings report `garmin_oauth` (`available`: the server has both credentials; `connected`; `needs_reconnect`: Garmin refused the refresh; `permissions`; `last_received_at`: when Garmin last pushed data for the user, or `null`; `delivers`: the data types the automatic pull currently leaves to it, see [When Connect with Garmin delivers a type](#when-connect-with-garmin-delivers-a-type)). `garmin_connected` is true for any of the three connections. The Garmin page shows "Last data received …" under the connection, or that nothing has arrived yet. The page's sync status, **Full Re-sync** and sync interval belong to the pull sync and show only with the login or a key.

### Data pushed by Garmin

The Developer Program does not let the server fetch a user's data on a timer. Garmin **pushes** it: each time the user's device syncs with Garmin Connect, Garmin POSTs the new summaries to the push URL (`POST /api/webhooks/garmin/<token>`, one URL for every summary type; see [Admin Setup](#admin-setup)). Nothing arrives until the device next syncs, and history from before the connection is not sent.

| Summary type (Garmin's key)                                                                                                  | What is stored                                                                                                                                        | Turned off by (`garmin_disabled_data_types`)    |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `dailies`                                                                                                                    | The pull's daily summary points (steps, distance, floors, active and total calories, resting HR, stress, SpO2), heart rate samples, intensity minutes | `dailySummary`, `heartRate`, `intensityMinutes` |
| `sleeps`                                                                                                                     | The night as a `sleep` activity with its stages and score, naps as `nap` activities                                                                   | `sleep`                                         |
| `hrv`                                                                                                                        | Last night's average as `hrv_rmssd`                                                                                                                   | `hrv`                                           |
| `stressDetails`                                                                                                              | Stress samples (`stress_level`) and body battery samples                                                                                              | `stress`, `bodyBattery`                         |
| `pulseox`                                                                                                                    | Every SpO2 sample as `spo2`, at its own time                                                                                                          | `spo2`                                          |
| `allDayRespiration`                                                                                                          | Every breathing-rate sample as `respiratory_rate`                                                                                                     | `respiration`                                   |
| `userMetrics`                                                                                                                | `vo2_max` at noon of the day                                                                                                                          | —                                               |
| `bodyComps`                                                                                                                  | `weight`, `body_fat` and `bone_mass` at the measurement time                                                                                          | —                                               |
| `activities`, `manuallyUpdatedActivities`                                                                                    | The activity, as the pull writes it (`garmin-activity-<activityId>`)                                                                                  | `activities`                                    |
| `activityFiles`                                                                                                              | Per-second metrics, GPS and the track from the activity's FIT file (see [Activity files](#activity-files))                                            | `activities`                                    |
| `activityDetails`                                                                                                            | Raw record only                                                                                                                                       | `activities`                                    |
| `epochs`, `healthSnapshot`, `skinTemp`, `bloodPressures`, `moveIQActivities`, `mct`, `menstrualCycleTracking`, any other key | Raw record only                                                                                                                                       | —                                               |

**Same rows as the pull.** The pushed summaries go through the same processors as the pull (`apps/backend/src/integrations/garmin/push-adapters.ts` turns each item into the pull's shape), so the points carry the same metric, source and time and the sleep the same `garmin-sleep-<calendarDate>` id (naps `garmin-nap-<start>`): an account with both the login (or key) and Connect with Garmin gets one copy of each, not two. A sleep Garmin first sends as tentative is replaced by the final one on the same row.

**Raw records.** Every item is kept, before anything else, as a raw record with `source: 'garmin'`, `record_type: 'garmin_push_<type in snake_case>'` (e.g. `garmin_push_dailies`, `garmin_push_stress_details`) and `external_id` the item's `summaryId` (else its `activityId`, else `<type>-<start time>`; an `activityFiles` notice is `file-<activityId>-<fileType in lower case>`, e.g. `file-123-fit`, so the notice for an activity's FIT file is found by exact id); Garmin resends a `summaryId` with fuller data during the day, which replaces the record. The Garmin user id and the `userAccessToken` some payloads carry are removed first. The pull's own raw records are never overwritten by the push.

**Handling a push** (`apps/backend/src/integrations/garmin/push.ts`). The path's token is an HMAC of the server's session secret; a wrong one, or a server without a Garmin client ID, answers `404`. A request carrying the token may have a body of up to 50 MB (Garmin's pushes can be large; a larger one answers `413`); anything else under the path is answered `404` before its body is read. A body that is not JSON, or is a bare JSON value such as a string, answers `200` with an empty body and a count in the server log, since Garmin would only resend it as it is. A `garmin-client-id` header that differs from the configured client ID answers `403`. Items are grouped by Garmin user id; ids no Aurboda user has connected are dropped (counted in the server log), as are items of a type whose every data type the user turned off. Nothing is stored for a read-only account, but a deregistration or a permission change for it is still acted on. The raw records are stored and one job per user, naming the stored records by type and external id (no item data, no Garmin user id, no token), is put on the durable `garmin-push-process` pg-boss queue; only then does the server answer `200` (a `500` when storing or queueing fails, so Garmin retries; a payload it cannot read is still a `200`, since Garmin disables an endpoint that keeps failing). A restart or an overlapping deploy after the answer therefore loses nothing: the job waits in the queue for whichever server picks it up. Without pg-boss (no `PGUSER`/`PGPASSWORD`) the jobs run in the receiving process instead and are lost on a restart.

**Processing a push** (`processGarminPushJob`). A server runs one job at a time. The job reads each named record as it is stored **now**, so when Garmin resends a summary the newest version is what is written, whichever job runs first; a record that no longer exists is skipped. The data types a type may write are taken from the user's `garmin_disabled_data_types` at that moment, and nothing is written for an account that has become read-only. Every type in the job is processed; a type that fails is audited for the user and its `garmin_push` sync state set to `error`, the other types are still written, and the job then fails, so pg-boss retries it with backoff (up to three times, from two minutes). Writing is idempotent, so a retry repeats the types that succeeded harmlessly. The connection notices (deregistrations and permission changes) are not queued: they are handled in the receiving process after the answer, and one that is lost shows at the next token refresh. Each summary type received writes a sync state row (provider `garmin_push`, `data_type` the type), which is where `last_received_at` comes from. One audit entry per user and push lists the counts per type. The URL, the token and Garmin user ids never reach an audit entry or a log line, and nginx does not log the path.

**Pushed activities.** An `activities` or `manuallyUpdatedActivities` item becomes the activity the pull writes for the same Garmin activity id (`garmin-activity-<activityId>`, its type mapped as the pull maps it, a Health Connect or older row of the same activity adopted), so the login or a key and Connect with Garmin give one row. Figures the item lacks are left out, keeping what the pull wrote; an item without `activityName` keeps the stored row's title, and one without `durationInSeconds` keeps its end (a new row falls back to the type key and to ending at its start); a pushed activity's `calories` is Garmin's active kilocalories. Pushed activities and sleeps are passed to deduction rules and auto-share as a pull sync's are, over the span of the items received.

#### Activity files

Garmin sends an `activityFiles` notice with a `callbackURL` to download the activity's original file. The FIT file is fetched once both the activity row and its notice are stored, whichever arrives last (`apps/backend/src/integrations/garmin/push-activity-file.ts`): a notice before its activity waits as a raw record until the activity is pushed. Only `https://apis.garmin.com/` is fetched, with the user's access token; any other address is refused and audited without the address. The file is written as the Personal API key's FIT file is: per-second metrics, GPS with precedence over other sources across the activity, and the track. The activity is then marked `detail_synced`, so the pull does not fetch its detail again, and a share waiting for the detail goes out. When Garmin answers `404` or `410` (the link lasts about a day), the activity is left unmarked, so the login or a key can still fetch its detail; a file that cannot be read is marked done, since asking again gives the same bytes. Its [strength sets](#strength-sets) are read too, unless the login's reader has already written the activity's sets. TCX and GPX files are kept as raw records only. The raw `activityFiles` record keeps Garmin's `callbackURL`; no audit entry or log line carries it or the access token.

**Connection notices.** A `deregistrations` notice can arrive late, after the user connected again, so the server first asks Garmin which user the stored grant belongs to (`GET .../user/id`). If it still answers for the same Garmin user, the notice is ignored. If Garmin refuses the grant (`401`/`403`, or a refused refresh) or there is none, the grant, the mapping and the `garmin_push` sync states are removed without calling Garmin back, and a warning is audited ("access removed from the Garmin side"). Any other failure leaves everything as it is and is audited. A `userPermissionsChange` notice replaces the stored permissions (`oauth_tokens.scopes`), which the Garmin page shows.

**Not covered.** Activity details are kept raw (the FIT file is the fuller recording); backfill of history is [#1786](https://github.com/fiddur/aurboda/issues/1786).

**Processing stored pushes again.** `POST /api/sync/garmin/reprocess-pushes` (body `{ since?: <ISO time> }`) and the MCP tool `reprocess_garmin_pushes` (same parameter) queue every `garmin_push_*` raw record of the user received since the time (default seven days ago; at most 90 days back, an earlier time is taken as 90 days ago) for processing again, the same way a fresh push is processed, in jobs of at most 2000 records. They answer `{ success: true, queued: <records queued> }`. Use them after processing failed or after the processing itself changed. A reprocessing writes no `garmin_push` sync state, so it does not count as a fresh push for the pull's [Connect with Garmin delivers this](#when-connect-with-garmin-delivers-a-type) rule, and a failed type keeps its `error` state until Garmin pushes it again. Records of a summary type the server does not know are left out. A read-only account cannot call them.

## Admin Setup

The login and the key need no server-side configuration: they use per-user credentials. Connect with Garmin needs an app in the [Garmin Connect Developer Program](https://developerportal.garmin.com): register the redirect URL `<API_BASE_URL>/auth/garmincb` (shown on the Admin Settings page) with it, and enter the app's client ID and secret under **Garmin Connect Developer Program** on the Admin Settings page (`garmin_client_id` / `garmin_client_secret`, see [Server administration](./admin.md#garmin-connect-developer-program)). Without them the Garmin page does not offer Connect with Garmin. Then copy the **Push URL** shown in the same block (`<API_BASE_URL>/webhooks/garmin/<token>`) into every endpoint at `https://apis.garmin.com/tools/endpoints` and choose "push"; without it no data arrives. The URL holds a secret derived from the server's `SESSION_SECRET` (changing that changes the URL): keep it private. Admins can stop new Personal API key connections with **Garmin Personal API keys** on the Admin Settings page (`garmin_personal_key_enabled`, on by default) — see [Server administration](./admin.md#garmin-personal-api-keys). Garmin's terms restrict a Personal API key to tools its owner operates for their own use; on a shared server a user who connects a key shares it with the server's operator, which the key form says.

## User Setup

### Connect with Garmin

1. Go to **Data Sources > Garmin** and click **Connect with Garmin**.
2. Sign in at Garmin and choose what to share with Aurboda.
3. Garmin sends you back to the Garmin page, which finishes the connection and shows **Connected** and what you share. Finish in a browser signed in to the same Aurboda account that started the sign-in: from the Android app that is the phone's browser. To change what you share, use your Garmin Connect account's connected apps settings.

Data arrives the next time your watch syncs with Garmin Connect; the page shows when it last did. Data from before you connect is not included: add the login or a Personal API key for history.

### Garmin login

The page calls it **Garmin login (email and password)**.

1. Go to **Data Sources > Garmin**
2. Enter your Garmin Connect **email** and **password**
3. Click **Connect**
4. If your account has MFA (multi-factor authentication) enabled, Garmin will send a verification code to your email. Enter the code in the form that appears and click **Verify Code**.
5. If successful, Settings will show "Connected"

**Important:** Your Garmin credentials are used only for the initial authentication and are **never stored** on the server. Only the resulting OAuth session tokens are persisted, which allow continued access without re-entering credentials.

### Switching from the login to Connect with Garmin

When the login is connected and the server offers Connect with Garmin, the Garmin page shows a **Switching to Connect with Garmin** note that follows you through the switch:

1. Click **Connect with Garmin** and finish the sign-in at Garmin.
2. Wait for the first data: it arrives the next time your watch syncs, and the page then shows when data was last received.
3. Disconnect the login, or keep both. Aurboda never disconnects the login by itself. The connections fill the same records, so keeping both counts nothing twice. Once data arrives, the login only fetches on its schedule what Connect with Garmin does not deliver (see [When Connect with Garmin delivers a type](#when-connect-with-garmin-delivers-a-type)); **Sync now** and **Full Re-sync** still fetch everything.

What stops when the login is disconnected depends on what else is connected:

- Connect with Garmin only: training readiness, data from before you connected, and **Sync now** and **Full Re-sync**.
- A Personal API key only: stress, the sleep stage timeline and training readiness.
- Both: training readiness.

### Personal API key

1. In Garmin Connect, create a key under **Settings > Personal API token** (`https://connect.garmin.com/app/settings/personalApiToken`). Garmin lets you choose its lifetime, a year at most, and does not report it back, so note the date.
2. Go to **Data Sources > Garmin**, paste the key under **Personal API key**, and set when it expires (30 days, 90 days, 180 days, 1 year, or any date).
3. Click **Connect key**. Aurboda exchanges the key with Garmin once; a key Garmin refuses is not stored.

REST: `POST /api/auth/garmin/personal-key` with `{ "api_key": "...", "expires_at": "YYYY-MM-DD" }` answers `200`, `400` (a missing key or a past date), `401` ("Garmin refused the key"), `403` (turned off by the admin) or `502` (another Garmin failure). There is no MCP tool for it, as for the other credential flows.

The key is stored in the user's own database (`oauth_tokens`, provider `garmin_personal`: the key in `refresh_token`, the expiry date entered in `expires_at`). It never appears in an API response, an audit entry or a log line. Each sync exchanges the key for a JWT that lasts 24 hours; the JWT is cached and replaced when less than an hour of it is left, or when Garmin answers `401`. When Garmin refuses the key itself (`401`/`403` on the exchange) the key is marked refused (`oauth_tokens.refused_at`, the time of the first refusal) and the Garmin page asks for a new one. A refusal can be passing (a WAF or geo block at Garmin's edge), so a refused key is exchanged again once a day (`updated_at` holds the last try): an accepted exchange clears `refused_at` and the key serves again, a refused one waits another day and keeps `refused_at`, and with it the refusal reminder, unchanged. A key replaced or removed while its exchange was in flight is left as the user set it, and the JWT that exchange got is not used: that fetch fails and the next one reads the new key.

The page shows when the key expires, as a warning from 14 days before and as an error once past or refused; **Replace key** stores a new one. Settings report the state as `garmin_personal_key` (`available`, `connected`, `expires_at`, `refused`), next to `garmin_session_connected`; `garmin_connected` is true for either.

#### Expiry reminders

Garmin does not report a key's expiry, so the reminders go by the date entered with it. Through the [central notifications](./features/notifications.md) (type `garmin_key_expiring`, **Garmin key renewal** under **Data sources** in the notification settings, where its in-app and push switches turn it off) the owner is told when 14 days are left, again at 3 days, once the date has passed, and once if Garmin refuses the key before then. Each opens the Garmin page. The five-minute background sync tick checks every user's key (`apps/backend/src/integrations/garmin/key-reminder.ts`); each reminder is stored once per expiry date, so a new key with a new date gets its own. Connecting a new key or disconnecting the key marks the earlier reminders read. No reminder carries the key.

"Once" holds while the reminder is kept: like every read notification, a read reminder is pruned 90 days after it was raised (`READ_RETENTION_DAYS`, when the next notification for the user is stored), which frees its dedupe key. A user who leaves an expired or refused key connected is therefore reminded again about every 90 days, until the key is replaced or disconnected.

## Sync

Manually trigger a sync to fetch the latest data:

- **REST:** `POST /api/sync/garmin`
- **MCP:** `sync_garmin()`

Options:

- `full_resync: true` -- Re-fetch all historical data (default: last 90 days)
- `start_date: "YYYY-MM-DD"` -- Start date for full resync

The sync fetches all 11 data types sequentially, each through the connection the table above picks; a type no connection serves is reported as `skipped`. Each data type's API is queried day by day (unlike Oura which supports date-range queries). A 100ms delay is added between day-fetches to avoid rate limiting.

Each data type tracks its own sync state, so incremental syncs only fetch new data since the last sync (with a 2-day overlap to catch retroactive edits).

Activities are keyed by `external_id = garmin-activity-<activityId>` and sleep by `garmin-sleep-<calendarDate>` — the same identity the Health Connect processor derives for sessions the Garmin Connect app writes, so both paths share one row (see [Health Connect → Source identity](./health-connect.md#source-identity)). Rows from before external ids existed are claimed on the next sync that touches them rather than duplicated. A type-mapping change still replaces such legacy rows; keyed rows are updated in place so an enriched Health Connect session and its notes survive.

The sleep row's `data.stages` holds the stage timeline in the Health Connect shape (`{ startTime, endTime, stage }`, stages `1` awake, `4` light, `5` deep, `6` REM), mapped from Garmin's `sleepLevels` (`activityLevel` 0 deep, 1 light, 2 REM, 3 awake). A night without levels leaves the key out so a Health Connect timeline already on the row is kept.

Rate limiting (HTTP 429 or similar errors) is handled automatically with exponential backoff (1, 5, 15, 60 minutes). If one data type hits a rate limit, remaining data types are skipped for that sync cycle.

## Auto-Sync

Garmin is polled by the background scheduler and topped up before queries, both governed by the user's `sync_intervals` setting (`garmin`, else `default`; server fallback 30 minutes) — see [Data Sources → Sync Behavior](./data-sources.md#sync-behavior). Every data type keeps its own sync state, so each is checked against the interval separately. A type Connect with Garmin delivers is not fetched: its sync state is stamped instead (see [When Connect with Garmin delivers a type](#when-connect-with-garmin-delivers-a-type)). A user who has connected Garmin in neither way is skipped before anything is read or written: no audit entry, no sync state, no request to Garmin. A manual sync for such a user returns an error per data type instead of attempting the fetch.

When the Android app delivers a Health Connect exercise or sleep session written by the Garmin Connect app, an enrichment job runs the Garmin `activities` (plus activity detail) or `sleep` sync for that user within about a minute, so the session gets its Garmin data without waiting for the poll. Garmin often lists a fresh activity before it serves the activity's detail; while the stored row is still without detail (`data.detail_synced`), the activity job fails and is retried with backoff (3 retries, from 2 minutes) instead of reporting success. A user with neither a usable key nor a login has no source for the detail, so the job does not wait for it, and neither does it when Connect with Garmin delivers activities, since the push brings the file itself.

When an activity's detail lands for the first time (the poll, a manual sync, the enrichment job) or is re-synced by hand, any feed post sharing it is re-federated as an `Update`, so followers get the settled distance, heart-rate chart and route map — see [Feed](./features/feed.md#publishing--lifecycle-delivery). Auto-share rules wait for the detail before sharing a Garmin-backed activity, for up to two hours — see [Auto-share rules](./features/auto-share-rules.md#evaluation--timing).

## Disconnecting

The three connections are disconnected separately:

- **Connect with Garmin:** `POST /api/auth/garmin/oauth/disconnect`, or **Disconnect** under Connect with Garmin on the Garmin page. Aurboda deregisters with Garmin (`DELETE https://apis.garmin.com/wellness-api/rest/user/registration`, best effort: a failure is audited and the rest goes ahead), deletes the grant, removes the Garmin user id mapping and clears the `garmin_push` sync states. Deleting the Aurboda account does the same. Removing Aurboda from the connected apps in Garmin Connect is handled through Garmin's deregistration notice (see [Data pushed by Garmin](#data-pushed-by-garmin)).
- **Login:** `POST /api/auth/garmin/disconnect`, or **Disconnect** under the login on the Garmin page. This removes the stored session tokens; you'll need to re-enter your credentials to reconnect. When another connection is also connected, the page lists what stops arriving without the login (see [Switching from the login to Connect with Garmin](#switching-from-the-login-to-connect-with-garmin)).
- **Key:** `POST /api/auth/garmin/personal-key/disconnect`, or **Disconnect key** on the Garmin page. This deletes the stored key. Revoke it in Garmin Connect too if you no longer use it.

## Limitations

- **Push only, no history:** Connect with Garmin receives data as the device syncs, from the time of connecting; a pushed activity has strength sets only when its FIT file arrives. The login and the key are pull only.
- **Session expiry:** Garmin Connect sessions may expire, requiring the user to re-authenticate by entering credentials again.
- **Key expiry:** a Personal API key lasts at most a year and must then be replaced by hand; [reminders](#expiry-reminders) come before the entered date.
- **MFA timeout:** The MFA verification code must be entered within 5 minutes of submitting credentials. If the session expires, start the login flow again.
- **Rate limiting:** neither the web API nor the Personal API publishes its rate limits. The day-by-day iteration with delays helps, but full resyncs of 90+ days may encounter limits.
