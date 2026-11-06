# Server administration

The first user to sign up becomes an admin. Admins manage server-wide settings (signup mode,
integration credentials, Sentry, plans and billing) from the web app's Admin Settings page. Those
settings, the admin list and the records below live in the central database (`CENTRAL_DB`, default
`aurboda`), not in any user's own database.

## User accounts

Every account has a row in the central `user_accounts` table, written at signup (password or
passkey) with the signup time. Accounts that existed before the table did get a row at the next
server start with no signup date and `pre_existing` set, since their signup date is unknown.

## Usage counters

So an admin can see who uses the server and how, the backend counts, per user and per UTC day:

| Kind     | What is counted                                                                                               | Channel                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `read`   | Successful authenticated REST `GET`/`HEAD` requests, and MCP calls of read-only tools                         | `web`, `android`, `api` (REST) or `mcp`                                |
| `write`  | Successful authenticated REST `POST`/`PUT`/`PATCH`/`DELETE` requests, and MCP calls of tools that change data | as for `read`                                                          |
| `ingest` | Each write of raw records or GPS points, with how many were stored                                            | The data source (`garmin`, `oura`, `health_connect`, `owntracks`, ...) |

Each row in the central `user_usage_daily` table holds a count, the number of items and the time of
the last event. For `ingest`, items are raw records written (a re-sync that overwrites records
already stored counts again) or GPS points newly stored (duplicates are skipped). Nothing else is stored: no paths, no request
content, no IP addresses. The REST channel comes from the `X-Aurboda-Client` header the web app and
Android app send, falling back to the `User-Agent`; anything else is `api`. MCP tools count as
writes when their name starts with a mutating verb (`add_`, `update_`, `delete_`, `sync_`, ... — see
`MUTATING_MCP_TOOL_PREFIXES` in `apps/backend/src/services/usage-channel.ts`). MCP calls are counted
when they arrive, so a failing tool call still counts, whereas REST counts only successful requests.
The Android app's screens that embed web pages send the web app's header, so that use counts as
`web`; `android` is the app's native sync.

Counts are aggregated in memory and written about once a minute and at shutdown, so a crash can lose
up to a minute of counts. Rows older than 400 days are deleted by the daily prune job (03:17 server
time, alongside the audit-log prune).

## Users page

The web app's Admin Settings page links to **Users** (`/admin/users`), a table of every user on the
installation — every user with a per-user database, whether or not they have a `user_accounts` row.
Click a column header to sort by it; the default is last UI use, most recent first.

| Column           | Meaning                                                                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User             | The username, marked _admin_ for admins.                                                                                                                                                                                              |
| Signed up        | The signup date, or _before tracking_ for an account that existed before signup dates were recorded.                                                                                                                                  |
| Plan             | The plan and its end (see [Plans and billing](#plans-and-billing)); grace and read-only are highlighted.                                                                                                                              |
| Storage          | Size of the user's database (`pg_database_size`), refreshed at most every five minutes.                                                                                                                                               |
| Data in          | Ingest events per day over the last 7 and 30 days (today included, UTC days), when data last came in, and the sources that sent data in the last 30 days. An event is one write of raw records or GPS points, however many it stored. |
| Last UI use      | When the user last read or wrote through the web app, and on how many of the last 30 days they did.                                                                                                                                   |
| Last MCP/API use | The latest use over MCP or the plain API (anything that is neither the web app nor the Android app), and how many reads those channels made in the last 30 days.                                                                      |

"Last" times look back over the whole usage retention (400 days); _never_ means no use in that time.
Clicking a row opens the user's page (`/admin/users/<username>`): signup date and storage, a 90-day
daily chart of ingest events by source, another of reads and writes by channel (`web`, `android`,
`mcp`, `api`), and the user database's ten largest tables (indexes included; tables an extension
owns, such as PostGIS's `spatial_ref_sys`, are left out).

The same data is available to admins over REST, `GET /admin/users` and
`GET /admin/users/:username?days=90` (1–400 days), and over MCP, `list_users` and `get_user_usage`.

## Deleting accounts

A user deletes their own account at the bottom of Settings; an admin deletes any other user from
that user's page (`/admin/users/<username>`). Either way the username has to be typed again to
confirm, and the deletion cannot be undone. REST: `DELETE /account` and
`DELETE /admin/users/:username`, each with `{ "confirm_username": "<username>" }`; MCP:
`delete_my_account` and the admin-only `delete_user`. Point the user at
[the data export](data-export.md) first if they want to keep their data.

Deleting an account, in order:

1. Reserves the username in the central `deleted_usernames` table (with who deleted it and when).
   Signup refuses a reserved name as taken, for good: other ActivityPub servers cache an actor and
   its key by URL, so a new account under the old name would inherit its followers and trust.
2. Sends a `Delete` of the actor to the user's followers on other servers, so they drop the follow
   and the cached profile.
3. Revokes the Oura, Strava and Gravl grants upstream and removes the Oura and Strava user mappings.
4. Drops the user's database and Postgres role: every metric, activity, location, setting,
   integration token, passkey, feed post, follower and key pair.
5. Removes every central row that names the user (admin entry, OAuth codes and tokens, passkey user
   handle, Oura and Strava mappings, the `user_accounts` row and the usage counters) and clears their
   name from the shared import jobs they started.

Steps 2 and 3 are best effort: a server or provider that cannot be reached is logged and skipped.
Dropping the database must succeed; if it fails the request answers 500 and can be retried (the
reservation stays). Nothing else of the user is kept; the server log gets one line naming the
account and who deleted it.

A deleted user's login tokens stop working at once, on every instance (each refreshes the list of
deleted names every two minutes). The actor URL and WebFinger answer `410 Gone` with a `Tombstone`.

The last admin cannot be deleted (the request answers 409): make another user admin first.

## Plans and billing

An installation can charge for accounts after a free trial. It is off by default and, while off,
changes nothing for anyone. Payments are recorded by hand: Aurboda takes no payments itself and
links to wherever the admin collects them (a Patreon page, say).

### Settings

Under **Plans and billing** on the Admin Settings page (REST `GET`/`PATCH /admin/settings`):

| Setting           | Default | Meaning                                                                                          |
| ----------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `billing_enabled` | off     | Whether accounts are billed at all.                                                              |
| `trial_days`      | 90      | Length of the free trial a new account starts on (0–3650).                                       |
| `grace_days`      | 14      | Days after a trial or paid period ends before the account turns read-only (0–365).               |
| `price_text`      | empty   | The price as users should read it, e.g. "3 € / month"; shown on the signup page and to the user. |
| `payment_url`     | empty   | Where users pay, an `https` URL.                                                                 |

The signup page says "Free for N days, then &lt;price&gt;." while billing is on (the public
`GET /status` carries `billing_enabled`, `trial_days` and `price_text`).

### Who is billed

- **Enabling billing marks every account that exists then as exempt.** Only accounts created after
  that start on a trial. Disabling billing lifts every restriction at once and does not undo the
  exempt marks, so enabling it again does not bill those accounts either.
- **Admins are never restricted**, whatever their plan says.
- An account signed up while billing is on starts on the `trial` plan, ending `trial_days` later.

Each account's plan is kept on its `user_accounts` row: `plan` (`exempt`, `trial` or `paid`; empty
for an account billing has never applied to, which is treated as exempt), `trial_ends_at`,
`paid_until` and a free-text `plan_note`.

### States

The account runs until the later of `trial_ends_at` and `paid_until`:

| State       | When                                                  | Effect                             |
| ----------- | ----------------------------------------------------- | ---------------------------------- |
| `active`    | Exempt, admin, billing off, or paid and not yet ended | None.                              |
| `trial`     | On the trial, not yet ended                           | None.                              |
| `grace`     | Ended, within `grace_days`                            | A warning banner; nothing blocked. |
| `read_only` | Ended more than `grace_days` ago                      | No new data is stored (see below). |

From 14 days before the end, the web app shows a dismissable notice with the payment link; in grace
and read-only it shows a warning that stays. Settings has a **Plan** section with the plan, its end
date, the price and the payment link. Users can read their own plan at `GET /account/plan` or with
the MCP tool `get_my_plan`.

### What read-only blocks and allows

A read-only user can still log in, browse everything, [export](data-export.md) their data and delete
their account. No new data is stored until the plan is renewed:

- Authenticated REST writes (`POST`, `PUT`, `PATCH`, `DELETE`) answer `402` with
  `{ "success": false, "error": "This account is read-only until the plan is renewed", "payment_url": … }`.
  Allowed anyway: `/export/*`, `DELETE /account` and passkey management (`/webauthn/*`).
- MCP tools that change data (the same verbs the usage counters treat as writes) return a tool error
  with the same message and the payment link, without running; `export_data_dump` and
  `delete_my_account` still work.
- OwnTracks posts answer `402`.
- Oura and Strava webhooks are acknowledged but not processed, and the background and on-demand
  pulls (Oura, Garmin, Gravl, RescueTime, Last.fm, calendars) skip the user.
- The Android app's sync gets the `402`s, does not retry them in a loop (WorkManager backs off), and
  shows the failure in its sync status.

Data is never deleted automatically. A status is cached for up to 30 seconds per server process; an
admin's change takes effect at once on the process that handled it.

### Recording a payment

Open the user's page (`/admin/users/<username>`) and use the **Plan** form: set _Paid until_ when the
user has paid (a future date on a trial account switches it to `paid`), change the plan or trial
end, or leave a note. The Users table has a **Plan** column (exempt, trial until …, paid until …,
grace, read-only) to sort by end date. REST: `PATCH /admin/users/:username/plan` with any of `plan`,
`paid_until`, `trial_ends_at` and `plan_note` (`null` clears a date or the note); MCP: the admin-only
`set_user_plan`.
