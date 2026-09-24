# Aurboda watch app (Garmin Connect IQ)

The Aurboda watch app is a Connect IQ app, in [`apps/garmin`](../apps/garmin), that records
sessions for any Aurboda activity type on a Garmin watch — including types Garmin has no sport
for (a custom type, or sex), which otherwise have to be logged as something else and retyped
afterwards. It works for any Aurboda user on any Aurboda server: nothing about a particular user,
server or watch is built in. The list it shows, and its order, come from the user's own
settings.

The watch records an ordinary Garmin activity. Garmin Connect syncs the FIT file as usual, and
Aurboda's existing [Garmin Connect](./garmin.md) import picks it up and types it. The watch needs
no network during a session, and uploads nothing itself.

## User setup

1. **Pick the types in Aurboda.** In the web app, go to **Data Sources → Garmin Connect → Watch
   app**. Add the activity types the watch should offer and put them in the order they should
   appear. For each one, set:
   - **Session name** — the label on the watch, at most 20 characters.
   - **Garmin sport** — what the session is recorded as in Garmin Connect (for example Yoga, or
     Meditation). Aurboda suggests the matching Garmin sport where one exists and _Other_
     otherwise.

   The list is stored as the `garmin_watch_types` user setting. Each entry also gets a `code`,
   a stable number the watch writes into the FIT file so the import can tell the types apart;
   it must stay the same for a type once sessions have been recorded with it.

2. **Point the app at your server.** In the Garmin Connect phone app, open the Aurboda app's
   settings (the watch's page → **Activities & Apps** → **Aurboda** → **Settings**):
   - **API URL** — the server's API base, `https://aurboda.net/api` by default.
   - **API token** — the token from **Generate API Token** on the Aurboda settings page (the same
     kind of token ActivityWatch uses). A watch cannot run a browser login.

The app fetches its configuration from the server through the phone, and keeps the last one it
got for when the phone is out of reach. **Refresh types** at the bottom of its menu fetches it
again.

## What is recorded

- **Heart rate**, natively, like any Garmin activity.
- **Developer field 40** — the Aurboda type code, written on every record.
- **Developer field 41** — the watch's live stress score, written on every record. Garmin
  firmware does not record stress during an activity, so without this there is none.

The field numbers are fixed in `garminWatchFitFields` in `@aurboda/api-spec`, which both the watch
app and the import read from.

**Garmin Connect does not keep the session name.** It shows the activity under its Garmin sport
(the one picked in step 1), which is why the type travels in a developer field rather than in the
name.

## How the import recognises it

Garmin's activity details expose developer fields as `connectIQDeveloperField-NN`. In the
[activity detail pass](./garmin.md#sync):

1. If the details carry field 40, its most frequent value is the type code. The code is looked up
   in the user's `garmin_watch_types`, and the activity is retyped to that entry's activity type,
   titled with its session name, and marked in `data` with `garmin_watch_type`,
   `garmin_watch_code` and `garmin_watch_session_name`. The audit log records
   `⌚ Garmin watch session typed as <type>`.
2. A code that is not in the list (or whose type has since been deleted) leaves the activity as
   Garmin typed it, with a warning in the audit log.
3. Field 41 is stored as `stress_level` (source `garmin`), but only when field 40 is present —
   other Connect IQ apps write their own numbered fields — and only when Garmin's own
   `directCurrentStress` is absent. When Garmin has stress, Garmin's wins.

**Re-syncs keep the type.** The activity summary sync overwrites the type and title from Garmin
on every run. When the stored activity carries `garmin_watch_type` (and that type still exists),
the summary sync keeps it and the session name instead of Garmin's sport.

## Config endpoint

What the watch fetches: the configured types in display order, each with its display name.

- **REST:** `GET /api/garmin-watch/config` → `GarminWatchConfigResponse`
- **MCP:** `get_garmin_watch_config()`

The list itself is read and written through the user settings: `GET/PATCH /api/user/settings`
and the `get_user_settings` / `update_user_settings` MCP tools (`garmin_watch_types`). Saving
checks that every activity type exists.

## Building and sideloading

The app is built with the Connect IQ SDK and a developer key, then copied onto the watch over USB
(the `.prg` goes in `GARMIN/APPS`). See [`apps/garmin/README.md`](../apps/garmin/README.md) for
the SDK setup, the build command and the supported devices.
