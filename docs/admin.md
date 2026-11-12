# Server administration

The first user to sign up becomes an admin. Admins manage server-wide settings (signup mode,
integration credentials, Sentry, plans and billing, support contacts, federation) from the web app's Admin Settings page. Those
settings, the admin list and the records below live in the central database (`CENTRAL_DB`, default
`aurboda`), not in any user's own database.

## User accounts

Every account has a row in the central `user_accounts` table, written at signup (password or
passkey) with the signup time. Accounts that existed before the table did get a row at the next
server start with no signup date and `pre_existing` set, since their signup date is unknown.

The row also holds the account's optional **email** address, given at signup or later in Settings
(**Profile**), over REST (`GET`/`PUT /account/email`, body `{ "email": "…" }`, `null` or an empty
string clears it) or over MCP (`get_my_email`, `set_my_email`). It is private: only the user and
the server's admins see it, it is never shown publicly and never federated. Nothing sends email to
it yet; it is meant for account recovery and plan reminders (#1510). Setting it never creates the
row: for an account without one (its signup could not write it; the next server start does) the
`PUT` answers `409` and `set_my_email` a tool error, and a signup's email is dropped with a logged
error, so a missing row still gets its trial from the backfill. The optional **display name**
given at signup is not on this row but a user setting (`display_name`), since it is part of the
public profile.

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
| User             | The username, marked _admin_ for admins, and the user's email when set.                                                                                                                                                               |
| Signed up        | The signup date, or _before tracking_ for an account that existed before signup dates were recorded.                                                                                                                                  |
| Plan             | The plan and its end (see [Plans and billing](#plans-and-billing)); grace and read-only are highlighted.                                                                                                                              |
| Storage          | Size of the user's database (`pg_database_size`), refreshed at most every five minutes.                                                                                                                                               |
| Data in          | Ingest events per day over the last 7 and 30 days (today included, UTC days), when data last came in, and the sources that sent data in the last 30 days. An event is one write of raw records or GPS points, however many it stored. |
| Last UI use      | When the user last read or wrote through the web app, and on how many of the last 30 days they did.                                                                                                                                   |
| Last MCP/API use | The latest use over MCP or the plain API (anything that is neither the web app nor the Android app), and how many reads those channels made in the last 30 days.                                                                      |

"Last" times look back over the whole usage retention (400 days); _never_ means no use in that time.
Clicking a row opens the user's page (`/admin/users/<username>`): signup date, email and storage, a 90-day
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

1. Sends a `Delete` of the actor to the user's followers on other servers, so they drop the follow
   and the cached profile.
2. Revokes the Oura, Strava and Gravl grants upstream and removes the Oura and Strava user mappings.
3. Reserves the username in the central `deleted_usernames` table (with who deleted it and when).
   Signup refuses a reserved name as taken, for good: other ActivityPub servers cache an actor and
   its key by URL, so a new account under the old name would inherit its followers and trust. Until
   this step the user's role and database keep signup from taking the name.
4. Drops the user's database and Postgres role: every metric, activity, location, setting,
   integration token, passkey, feed post, follower and key pair.
5. Removes every central row that names the user (admin entry, OAuth codes and tokens, passkey user
   handle, Oura and Strava mappings, the `user_accounts` row and the usage counters) and clears their
   name from the shared import jobs they started.

Steps 1 and 2 are best effort: a server or provider that cannot be reached is logged and skipped.
Dropping the database must succeed; if it fails the request answers 500 and can be retried (the
reservation stays). Nothing else of the user is kept; the server log gets one line naming the
account and who deleted it.

If a deletion fails part-way, run it again from the admin users page or `delete_user`: it finishes
the job. Once the database is gone the user no longer appears on the admin users page (it lists
databases), so finish it with MCP `delete_user` or `DELETE /admin/users/:username`: for a reserved
name without a database they drop the role if it is still there and remove the remaining central
rows. A failure of step 5 is only logged and the deletion still reports success, so the server log
is where it shows.

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
- **Admins are never restricted**, whatever their plan says, and `GET /account/plan` reports them as
  `exempt`.
- An account signed up while billing is on starts on the `trial` plan, ending `trial_days` later.
  If its `user_accounts` row could not be written at signup, the backfill at the next server start
  creates the row and, while billing is on, starts the trial then.

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
  `{ "success": false, "error": "This account is read-only until the plan is renewed", "payment_url": … }`
  (the `AccountReadOnlyResponse` schema in the OpenAPI document).
  Allowed anyway: `/export/*`, `DELETE /account`, `PUT /account/email`, passkey management (`/webauthn/*`) and the
  previews that store nothing (`POST /autoshare-rules/preview`, `/deduction-rules/preview`,
  `/feed/activities/:id/preview` and `/feed/exercises/preview`).
- MCP tools that change data (the same verbs the usage counters treat as writes) return a tool error
  with the same message and the payment link, without running; `export_data_dump`,
  `delete_my_account` and `set_my_email` still work.
- OwnTracks posts answer `402` with the same body.
- Oura and Strava webhooks are acknowledged but not processed, and the background and on-demand
  pulls (Oura, Garmin, Gravl, RescueTime, Last.fm, calendars) skip the user. Strava jobs queued
  before the account turned read-only are checked again when they run and complete without fetching.
- Inbound ActivityPub posts and replies (`Create`/`Update` of a Note, boosts of other people's
  posts) are acknowledged but not stored. Follows, unfollows, accepts, deletes, profile updates,
  likes or boosts of the user's own posts and quote requests (`QuoteRequest`) for them are still
  processed.
- The Android app's sync stops its run at the first `402` without retrying, keeps the queued data
  for when the plan is renewed, and shows the server's message in its sync status. A `402` never
  logs the app out (a `401` does).

Data is never deleted automatically. A status is cached for up to 30 seconds per server process; an
admin's change takes effect at once on the process that handled it.

### Recording a payment

Open the user's page (`/admin/users/<username>`) and use the **Plan** form: set _Paid until_ when the
user has paid (a future date on a trial account switches it to `paid`), change the plan or trial
end, or leave a note. The Users table has a **Plan** column (exempt, trial until …, paid until …,
grace, read-only) to sort by end date. REST: `PATCH /admin/users/:username/plan` with any of `plan`,
`paid_until`, `trial_ends_at` and `plan_note` (`null` clears a date or the note); MCP: the admin-only
`set_user_plan`.

## Support contacts

How users reach the person who runs the server outside GitHub, set under **Support contacts** on
the Admin Settings page (REST `GET`/`PATCH /admin/settings`). Both are empty by default; an empty
value hides it.

| Setting             | Accepted input                                                                       | Stored as                                  |
| ------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------ |
| `contact_fediverse` | `@name@host` or `name@host`                                                          | `name@host`                                |
| `contact_reddit`    | `name`, `u/name`, `/u/name` or a `reddit.com/user/name` URL (`www.`, `old.` or none) | `name` (3–20 of letters, digits, `_`, `-`) |

Anything else is refused with `400`. When either is set, the Help page gets a **Contact the
server's admin** section, and the Contact sections of the Privacy Policy and Terms of Service name
them next to the Aurboda project on GitHub (without them, those say to contact the administrator of
the server). A fediverse handle on this server links to the local public profile at `/u/<name>`,
one elsewhere to `https://<host>/@<name>`; the Reddit username links to a new private message. The
public `GET /status` carries both as `contact_fediverse` and `contact_reddit` (null when unset).

## Federation

**Tag actor host** (`tag_actor_host`, Admin Settings → **Federation**, `PATCH /admin/settings`):
the host whose actors users follow to follow a hashtag. Following `#running` follows
`running@<host>`; the default, used when it is unset or empty, is `tags.pub`, the public tag relay
run by the Social Web Foundation. The value is a bare hostname (trimmed and lowercased; a scheme,
path, port, `@` or whitespace is refused with `400`). Changing it affects new tag follows only:
existing ones keep following the actor they followed. See
[Following a hashtag](features/feed.md#hashtags).

**Relays** (Admin Settings → **Federation** → Relays; REST `GET/POST /admin/relays`,
`DELETE /admin/relays/:id`; MCP `list_relays`, `add_relay`, `remove_relay`, all admin-only). A
relay is a fediverse service that redistributes the public posts it receives, so servers whose
users never followed anyone here still see them. The server subscribes through its **instance
actor**, an `Application` at `<origin>/actor` (WebFinger `acct:<host>@<host>`), with its own key
pair in the central `instance_actor` table. Two styles:

- **Mastodon** (tags.pub, FediBuzz, pub-relay, Activity-Relay): enter the relay's **inbox URL**.
  The instance actor sends it a `Follow` of the Public collection.
- **LitePub** (Pleroma/Akkoma relays): enter the relay's **actor URL**. It is resolved for its
  inbox and followed directly; the relay follows the instance actor back, which is accepted only
  for an added relay's actor.

A relay starts **Pending** and becomes **Accepted** (or **Rejected**) when it answers. A Follow that
could not be delivered keeps the relay pending with the error shown on its badge; remove it and
add it again to retry. Removing a relay sends it an `Undo` of the Follow. Only https URLs that
resolve to public addresses are taken (`400`); an already added relay is `409`; a LitePub actor
that cannot be resolved is `422`.

Once a relay is accepted, every **public** post of every user on this server (its `Create`,
`Update` and `Delete`) is also delivered to the relay's inbox, signed by the post's author.
Unlisted and followers-only posts, replies, likes and boosts are never pushed. Whatever a relay
sends back (LitePub relays forward other servers' posts as `Announce`s) is dropped: nothing reaches
anyone's timeline through a relay. The tags.pub relay is
`https://tags.pub/user/_____relay_____/inbox` (Mastodon style); it is one-way, taking posts and
sending none, and lets [hashtag](features/feed.md#hashtags) followers anywhere see posts from here.
Every server subscribes to it **by default**, once: on the first startup on a public https origin
(`WEB_HOST` not http, `localhost`, `*.localhost` or a loopback address), upgrades included, the
server adds it as if an admin had, and records that in the internal `default_relays_seeded` server
setting. A server that already has it counts as done; a failed add is tried again on the next
startup. To opt out, remove it under Relays: a removed relay stays removed.
When a post stops being public, or is deleted, the relays get a `Delete` of it; deleting an
account sends its actor `Delete` to the relays as well as to its followers. A one-way relay like
tags.pub is cheap; a full (two-way) relay forwards its whole firehose to `/inbox`, where each
activity is signature-verified and dropped.

**Re-send post Updates** (REST `POST /admin/federation/resend-post-updates`; MCP
`resend_post_updates`, both admin-only) re-sends the `Update` of every public and unlisted post of
every user on this server to the same audience an edit reaches, so remote servers refresh their
copy. Run it once after upgrading to a release with quote posts: Mastodon cached "nobody may quote"
for posts federated before their Notes declared a quote policy, and the `Update` carries the policy.
Like an edit, the `Update` reaches only the servers of the author's followers (and the relays, for
a public post): a server that cached a post without anyone there following its author, say through a
boost or a search, keeps the old policy.
Only `Update`s are sent, so running it again is harmless. It answers `202` with the number of posts
(`posts`) at once and delivers them one after another in the background; a post whose delivery takes
over a minute counts as failed and the run moves on. The server log has a line when the run starts
(posts) and when it ends (posts, failed). A second request while one is still delivering is `409`.

**Public tag pages** (`public_tag_pages`, `public_tag_retention_days`, Admin Settings → **Public
tag pages**, `PATCH /admin/settings`): up to 20 hashtags, each with a public page at
`/tags/<tag>` listing the public posts carrying it from every server the tag actor host sees, plus
this server's own. Saving the list makes the instance actor follow `<tag>@<tag actor host>` (e.g.
`aurboda@tags.pub`) for every added tag, as it follows a relay, and unfollow (`Undo{Follow}`) every
removed one; the follow is pending until the tag actor accepts, and only an accepted tag actor's
`Announce`s are kept. A tag whose actor cannot be resolved still stays in the setting, with no
follow, and is tried again on the next save that lists it; a pending follow is re-sent on every
save, and changing the tag actor host moves every follow to the new host. The section shows a
badge per tag (`public_tag_follows`): **accepted**, **pending**, or **unresolved**. There is no
moderation of tag pages yet beyond removing the tag; a follow-up issue tracks hiding posts and
blocking actors and domains. Posts are kept for
`public_tag_retention_days` (1–365, default 30) by publication time; a nightly job (`23 3 * * *`)
re-applies the follows, then drops older ones (but the official feed's remote posts) and the ones
that carry no followed tag any more. The instance actor also follows the
[official feed](features/feed.md#official-feed)'s tags while it lists authors on other servers;
those tags get no page. This server's own public
posts are added as they are published from then on: posts published before a tag was configured
are not backfilled. `GET /status` lists the tags (`public_tag_pages`) so the front page, `/blog`
and the logged-out web can link the pages. See
[Public tag pages](features/feed.md#public-tag-pages).
