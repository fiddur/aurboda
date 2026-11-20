# Notifications

One central place for everything the server wants to tell a user: a 🛎 bell with an unread badge,
read state, and per-type switches for whether a type shows under the bell and whether it is pushed
to the phone app and to the browsers the user turned push on in.

## Model

Notifications live in the user's own database, in two tables:

- `notifications`: one row per notification: `type`, `title`, optional `body`, `link` (an in-app
  path such as `/admin/users/alice`) and `data` (type-specific JSON), `actions` (the buttons it
  offers, see [Actions](#actions)), an optional unique `dedupe_key`, the two switches `in_app` and
  `push` as they were when it was raised, and `read_at`.
- `notification_preferences`: one row per type the user has changed. A type without a row has both
  switches on.

`type` is plain text, not an enum, so a type can be added without a schema change. The types and
their labels are the registry `notificationTypes` / `notificationTypeInfo` in
`packages/api-spec/src/schemas/notifications.ts`.

Each type belongs to a **group** (`feed`, `data_sources`, `reminders`, `admin`), which is how Settings →
**Notifications** lays them out: one block per group in that order, and none for a group with no
type this user can receive.

| Type                   | Group        | Raised when                                                                                                                                                                                                                                                                                                                                                                                                | Who gets it                                       |
| ---------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `feed_follow_request`  | Feed         | A first `Follow` arrives while you approve followers by hand                                                                                                                                                                                                                                                                                                                                               | The followed user                                 |
| `feed_new_follower`    | Feed         | A `Follow` is accepted on arrival (a redelivery from an accepted follower raises nothing; approving a request by hand raises nothing either)                                                                                                                                                                                                                                                               | The followed user                                 |
| `feed_follow_accepted` | Feed         | A person you asked to follow accepts after the follow waited at least five minutes (an instant auto-accept is not news; tag follows and relays never raise it)                                                                                                                                                                                                                                             | The follower                                      |
| `feed_reply`           | Feed         | A new Note replying to one of your posts arrives on the live inbox (from anyone; a reply that also mentions you is one reply)                                                                                                                                                                                                                                                                              | The author of the post replied to                 |
| `feed_mention`         | Feed         | A new Note mentioning you arrives on the live inbox, from anyone                                                                                                                                                                                                                                                                                                                                           | The mentioned user                                |
| `feed_like`            | Feed         | Someone likes one of your posts for the first time (an `Undo` leaves the notification alone)                                                                                                                                                                                                                                                                                                               | The post's author                                 |
| `feed_boost`           | Feed         | Someone boosts one of your posts for the first time (a boost by a hashtag account on the tag actor host is the tag feed listing it and raises nothing)                                                                                                                                                                                                                                                     | The post's author                                 |
| `feed_post`            | Feed         | A new top-level post, or a boost card, from a person you follow whose bell is on in your Following list, or a new post arriving through a followed tag whose bell is on in your Followed tags list, that your timeline shows (`timeline_show_replies`)                                                                                                                                                     | The reader                                        |
| `challenge_comment`    | Feed         | Someone comments, or replies, in the comment thread of a challenge you host or take part in (once per new comment; not for edits, shares or the result post)                                                                                                                                                                                                                                               | The host and every local member except the author |
| `autoshare_pending`    | Feed         | An [auto-share rule](auto-share-rules.md#pending-share-notification) is about to share a new activity; revised in place to "was shared" or "will not be shared" (also when the share no longer happens)                                                                                                                                                                                                    | The activity's owner                              |
| `garmin_key_expiring`  | Data sources | A [Garmin Personal API key](../garmin.md#expiry-reminders) has 14 days left, again at 3 days, once it has expired, and once Garmin refuses it; checked by the five-minute sync tick, each step once per expiry date (the refusal once per refusal; again about every 90 days while a dead key stays connected, once the read reminder is pruned), and marked read when the key is replaced or disconnected | The key's owner                                   |
| `reminder`             | Reminders    | A [reminder](reminders.md) you set up is due (once per occurrence; its earlier unread ones are marked read)                                                                                                                                                                                                                                                                                                | The reminder's owner                              |
| `check_in_due`         | Reminders    | A slot of a [check-in](check-ins.md) form you scheduled is due (once per slot, within an hour of its time; marked read when a check-in does the slot)                                                                                                                                                                                                                                                      | The form's owner                                  |
| `admin_signup`         | Admin        | An account is created (password, passkey or single sign-on signup), or a single sign-on signup could not be finished nor rolled back                                                                                                                                                                                                                                                                       | Every admin except the new account itself         |

The feed types are raised by the ActivityPub inbox (`apps/backend/src/services/activitypub/federation.ts`)
from pure builders in `apps/backend/src/services/social-notifications.ts`, after the event is stored,
and each carries a `dedupe_key` (the object or activity id) so a redelivery is stored once. Neither
the on-follow backfill of a followee's older posts nor an `Update` of a stored post raises
anything. `feed_post` is narrowed per account by the bell in the Following list and per tag by the bell in
the Followed tags list (`notify_on_post`): the type's switches turn the whole kind on or off, the
bells pick the accounts and the tags. A followed tag boosts every post carrying it, replies
included; only its top-level posts raise `feed_post` (a person's boost of a reply still does). Replies and
mentions ignore the bell, since they are addressed to you. A read-only account stores no new
inbound posts, so it gets no reply, mention or post notifications; follows and reactions still
notify.

## The two switches

Each type has an **In-app** switch (show under the bell) and a **Push** switch (deliver to the
Android app and to subscribed browsers, see [Browser push](#browser-push)), both on by default, set in Settings → **Notifications** or with `PUT
/notifications/types/:type`. They are applied when a notification is raised, and copied onto the
row:

- both on: stored, shown under the bell and listed for push;
- one off: stored with that switch off, so it is left out of that list;
- both off: not stored at all.

Changing a switch affects notifications raised from then on, not the ones already stored.
**Mark all read** stamps every unread row, push-only ones included: a device poller asks for
unread ones only, so it also withdraws whatever has not been pushed yet, which is intended.
Admin-only types are listed and settable for admins only.

A read-only account (see [plans and billing](../admin.md#plans-and-billing)) can still mark notifications read, since the
reminders about its plan are addressed to exactly that account; it cannot change the switches.

## Actions

A notification can offer buttons: `actions` is a list of `{ key, label }`, empty for most types.
The client never interprets one: it shows a button per entry and calls `POST
/notifications/:id/actions/:key` (MCP `run_notification_action`). The server owns the meaning: it
maps the notification's type and the key to a handler (registered in `apps/backend/src/api.ts`),
runs it, and revises the notification with the outcome. Running an action marks the notification
read and clears its actions, so it runs at most once; a second call answers 404. When the handler
cannot do it (the activity was already shared, say) the answer is 409 with the reason, and the
notification is still revised to say what happened.

The only action so far is `skip` ("Don't share") on `autoshare_pending`.

## Browser push

A browser can receive the push notifications too, as system notifications, with no Aurboda tab
open (Web Push). Settings → **Notifications** has **Push in this browser**: **Enable** asks the
browser for permission and subscribes it, **Disable** unsubscribes it, **Send test** sends "Aurboda
can reach this browser" to every subscribed browser, and the user's other subscribed browsers are
listed with **Remove**. When the browser has blocked notifications the section says so and how to
allow them again. The bell's dropdown offers enabling once (dismissing it is remembered in that
browser) to a signed-in user whose browser is not subscribed. Neither is shown inside the Android
app's embedded pages (the app delivers natively), in a browser without the Push API, or when the
server does not offer push. On an iPhone or iPad, push works only for a web app added to the home
screen, which the text says. Signing out removes the browser's subscription, and a subscription
that the signed-in account does not list (another account used the browser, or it was removed from
elsewhere) is dropped when the app loads and before enabling, so one account's notifications never
show in another's session.

**Keys.** The server has one VAPID key pair, generated on first use and kept in the central
database's `server_settings` (`web_push_vapid_keys`). The VAPID subject is the web address
(`WEB_HOST`). Push is offered only when `WEB_HOST` is HTTPS (or `localhost`, for development),
since browsers refuse it elsewhere; `GET /notifications/push/config` answers `enabled: false`
otherwise.

**Subscriptions** live in the user's database, table `push_subscriptions`: `endpoint` (unique),
the keys `p256dh` and `auth`, `user_agent`, `created_at`, `last_success_at` and `failure_count`.
Subscribing the same endpoint again updates it. The endpoint must be an HTTPS URL on a public
address (the outbound check federation uses), checked when subscribing and again before each send.
A user keeps at most 20; past that the one that has gone longest without a push is dropped. Answers
never include the keys: a subscription is listed with a browser label derived from its user agent
("Firefox on Android").

**Sending.** When a notification with its push switch on is stored, the notifier queues a job
(pg-boss queue `web-push`) and returns; the raise never waits for it nor fails because of it.
The job sends `{ id, type, title, body, link }`, encrypted to each browser by the Web Push standard
so the push service cannot read it, with a TTL of one day and, for a notification with a dedupe
key, a `Topic` derived from that key. A revised notification (such as `autoshare_pending` turning
into "was shared") is queued again under the same topic and with the same notification id as its
tag, so it replaces the one shown. A notification already read when the job runs is not sent.
An answer of 404 or 410 deletes the subscription; a success stamps `last_success_at` and clears
`failure_count`; any other failure counts up, and the job is retried twice with backoff, to the
failed browsers only. A subscription that fails 20 times in a row is deleted. A notification
marked read elsewhere is not withdrawn from the browser.

**Service worker.** `apps/web/public/sw.js` (served at `/sw.js` with `Cache-Control: no-cache`)
does only this: no caching, no offline. On `push` it shows the notification, tagged with its id;
a click focuses an open Aurboda tab and navigates it (or opens one) to the notification's `link`,
or `/notifications` without one, with `?notification_read=<id>`. The page then marks it read, as a
click in the bell does, and drops the parameter from the address.

## API

| Route                                          | MCP tool                      | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /notifications`                           | `list_notifications`          | Newest first, `limit` (1–100, default 20), keyset `cursor` from `next_cursor`. By default the in-app ones; `push_only=true` lists those meant for push whatever their in-app switch. `unread_only` and `after` (ISO time, strictly after) narrow it, which is what a device poller uses with its high-water mark. `ids` (comma-separated, at most 100) lists only those notifications, read or not unless `unread_only` is set, so a device can update or withdraw the ones it shows; an id missing from the answer was deleted. `unread_count` always counts every unread in-app notification |
| `POST /notifications/:id/read`                 | `mark_notification_read`      | Mark one read; an already read one keeps its first `read_at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `POST /notifications/:id/actions/:key`         | `run_notification_action`     | Run one of the notification's `actions`; answers the revised notification, 404 when it offers no such action (any more), 409 with the reason when it cannot be done                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `POST /notifications/read-all`                 | `mark_all_notifications_read` | Mark every unread one read; returns how many                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `GET /notifications/types`                     | `list_notification_types`     | The types this user can receive, with label, description, group and both switches                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `PUT /notifications/types/:type`               | `set_notification_preference` | Body `{ in_app?, push? }` (at least one); 404 for an unknown type or an admin-only one for a non-admin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `GET /notifications/push/config`               | —                             | `{ enabled, public_key }`: whether the server offers browser push, and the VAPID key to subscribe with                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `GET /notifications/push/subscriptions`        | `list_push_subscriptions`     | The subscribed browsers; `endpoint_hash` (SHA-256 of its endpoint) marks this browser's own one `current`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `POST /notifications/push/subscriptions`       | —                             | Subscribe a browser with its `PushSubscription` JSON (needs a browser, so no MCP tool); 400 for an endpoint that is not HTTPS on a public address, 409 when push is off                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `DELETE /notifications/push/subscriptions/:id` | `delete_push_subscription`    | Remove a subscribed browser                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `POST /notifications/push/test`                | `send_test_push`              | Send a test push to every subscribed browser (not stored); answers `reached` and `total`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `GET /events/stream`                           | —                             | Server-Sent Events: an empty `event: notification` whenever the user's notifications change (and `event: timeline` for the [home timeline](feed.md#live-updates)); a stream, so no MCP tool                                                                                                                                                                                                                                                                                                                                                                                                    |

## The bell

On a wide screen the bell sits in the sidebar header (also when the sidebar is collapsed) and
opens a dropdown with the latest 20, **Mark all read**, and links to the full list and the
settings. On a narrow screen it sits in the top bar and links to `/notifications`, the full list
with **Load more**. The Android app opens the same page from **More → Notifications**. The badge
shows the unread count (`9+` above nine) and is live: raising, revising or reading a notification,
in this tab, another tab or through the API or MCP, pings the user's
[live stream](feed.md#live-updates) (`event: notification`, no content), and every open tab refetches
the bell within a second. The ping goes out after the row is stored, never delays or fails the
raise, and a raise that stores nothing sends none. The minute's refresh and the one when the
window regains focus stay as the fallback. Activating a notification marks it read and opens its
link.

## Pruning

Each time a notification is stored, read ones older than 90 days and any older than 365 days are
deleted.

## Adding a notification type

1. Add the type to `notificationTypes` and `notificationTypeInfo` in
   `packages/api-spec/src/schemas/notifications.ts` with its `group` (`admin_only` if only admins
   should get it).
2. Rebuild and regenerate: `pnpm --filter @aurboda/api-spec build`, then
   `cd packages/api-spec && pnpm generate`.
3. Raise it where the event happens:

   ```ts
   import { notifier } from '../services/notifications.ts'

   await notifier.raiseBestEffort(user, {
     type: 'my_type',
     title: 'Short headline',
     body: 'Optional details',
     link: '/in-app/path',
     dedupe_key: 'my_type:<something unique>',
   })
   ```

   `raiseBestEffort` logs and swallows any error, so it is safe on a hot path; `raise` throws and
   returns the stored row. Give a `dedupe_key` to anything a recurring job raises, so the same
   event is stored once however often the job sees it.

4. To change a notification once the event moves on, revise it by its dedupe key rather than
   raising a second one:

   ```ts
   await notifier.reviseBestEffort(user, 'my_type:<something unique>', {
     title: 'What happened',
     link: '/new/path',
     actions: [],
   })
   ```

   Only the fields given change; `created_at` stays, so a device poller does not deliver it again.

5. For buttons, give `actions: [{ key, label }]` when raising, and register a handler for
   `(type, key)` in the `runNotificationAction` handlers in `apps/backend/src/api.ts`.
