# Notifications

One central place for everything the server wants to tell a user: a 🛎 bell with an unread badge,
read state, and per-type switches for whether a type shows under the bell and whether it is pushed
to the phone.

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

Each type belongs to a **group** (`feed`, `data_sources`, `admin`), which is how Settings →
**Notifications** lays them out: one block per group in that order, and none for a group with no
type this user can receive.

| Type                   | Group | Raised when                                                                                                                                                                       | Who gets it                               |
| ---------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `feed_follow_request`  | Feed  | A first `Follow` arrives while you approve followers by hand                                                                                                                      | The followed user                         |
| `feed_new_follower`    | Feed  | A `Follow` is accepted on arrival (a redelivery from an accepted follower raises nothing; approving a request by hand raises nothing either)                                      | The followed user                         |
| `feed_follow_accepted` | Feed  | A person you asked to follow accepts after the follow waited at least five minutes (an instant auto-accept is not news; tag follows and relays never raise it)                    | The follower                              |
| `feed_reply`           | Feed  | A new Note replying to one of your posts arrives on the live inbox (from anyone; a reply that also mentions you is one reply)                                                     | The author of the post replied to         |
| `feed_mention`         | Feed  | A new Note mentioning you arrives on the live inbox, from anyone                                                                                                                  | The mentioned user                        |
| `feed_like`            | Feed  | Someone likes one of your posts for the first time (an `Undo` leaves the notification alone)                                                                                      | The post's author                         |
| `feed_boost`           | Feed  | Someone boosts one of your posts for the first time                                                                                                                               | The post's author                         |
| `feed_post`            | Feed  | A new top-level post, or a boost card, from a person you follow whose bell is on in your Following list, that your timeline shows (`timeline_show_replies`); tag follows never do | The reader                                |
| `autoshare_pending`    | Feed  | An [auto-share rule](auto-share-rules.md#pending-share-notification) is about to share a new activity; revised in place to "was shared" or "will not be shared"                   | The activity's owner                      |
| `admin_signup`         | Admin | An account is created (password or passkey signup)                                                                                                                                | Every admin except the new account itself |

The feed types are raised by the ActivityPub inbox (`apps/backend/src/services/activitypub/federation.ts`)
from pure builders in `apps/backend/src/services/social-notifications.ts`, after the event is stored,
and each carries a `dedupe_key` (the object or activity id) so a redelivery is stored once. Neither
the on-follow backfill of a followee's older posts nor an `Update` of a stored post raises
anything. `feed_post` is narrowed per account by the bell in the Following list (`notify_on_post`):
the type's switches turn the whole kind on or off, the bell picks the accounts. Replies and
mentions ignore the bell, since they are addressed to you. A read-only account stores no new
inbound posts, so it gets no reply, mention or post notifications; follows and reactions still
notify.

## The two switches

Each type has an **In-app** switch (show under the bell) and a **Push** switch (deliver to the
phone), both on by default, set in Settings → **Notifications** or with `PUT
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

## API

| Route                                  | MCP tool                      | What it does                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /notifications`                   | `list_notifications`          | Newest first, `limit` (1–100, default 20), keyset `cursor` from `next_cursor`. By default the in-app ones; `push_only=true` lists those meant for push whatever their in-app switch. `unread_only` and `after` (ISO time, strictly after) narrow it, which is what a device poller uses with its high-water mark. `unread_count` always counts every unread in-app notification |
| `POST /notifications/:id/read`         | `mark_notification_read`      | Mark one read; an already read one keeps its first `read_at`                                                                                                                                                                                                                                                                                                                    |
| `POST /notifications/:id/actions/:key` | `run_notification_action`     | Run one of the notification's `actions`; answers the revised notification, 404 when it offers no such action (any more), 409 with the reason when it cannot be done                                                                                                                                                                                                             |
| `POST /notifications/read-all`         | `mark_all_notifications_read` | Mark every unread one read; returns how many                                                                                                                                                                                                                                                                                                                                    |
| `GET /notifications/types`             | `list_notification_types`     | The types this user can receive, with label, description, group and both switches                                                                                                                                                                                                                                                                                               |
| `PUT /notifications/types/:type`       | `set_notification_preference` | Body `{ in_app?, push? }` (at least one); 404 for an unknown type or an admin-only one for a non-admin                                                                                                                                                                                                                                                                          |

## The bell

On a wide screen the bell sits in the sidebar header (also when the sidebar is collapsed) and
opens a dropdown with the latest 20, **Mark all read**, and links to the full list and the
settings. On a narrow screen it sits in the top bar and links to `/notifications`, the full list
with **Load more**. The Android app opens the same page from **More → Notifications**. The badge
shows the unread count (`9+` above nine) and refreshes every minute and when the window regains
focus. Activating a notification marks it read and opens its link.

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
