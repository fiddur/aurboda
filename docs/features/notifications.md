# Notifications

One central place for everything the server wants to tell a user: a 🛎 bell with an unread badge,
read state, and per-type switches for whether a type shows under the bell and whether it is pushed
to the phone.

## Model

Notifications live in the user's own database, in two tables:

- `notifications`: one row per notification: `type`, `title`, optional `body`, `link` (an in-app
  path such as `/admin/users/alice`) and `data` (type-specific JSON), an optional unique
  `dedupe_key`, the two switches `in_app` and `push` as they were when it was raised, and `read_at`.
- `notification_preferences`: one row per type the user has changed. A type without a row has both
  switches on.

`type` is plain text, not an enum, so a type can be added without a schema change. The types and
their labels are the registry `notificationTypes` / `notificationTypeInfo` in
`packages/api-spec/src/schemas/notifications.ts`.

| Type           | Raised when                                        | Who gets it                               |
| -------------- | -------------------------------------------------- | ----------------------------------------- |
| `admin_signup` | An account is created (password or passkey signup) | Every admin except the new account itself |

## The two switches

Each type has an **In-app** switch (show under the bell) and a **Push** switch (deliver to the
phone), both on by default, set in Settings → **Notifications** or with `PUT
/notifications/types/:type`. They are applied when a notification is raised, and copied onto the
row:

- both on: stored, shown under the bell and listed for push;
- one off: stored with that switch off, so it is left out of that list;
- both off: not stored at all.

Changing a switch affects notifications raised from then on, not the ones already stored.
Admin-only types are listed and settable for admins only.

A read-only account (see [plans and billing](../admin.md#plans-and-billing)) can still mark notifications read, since the
reminders about its plan are addressed to exactly that account; it cannot change the switches.

## API

| Route                            | MCP tool                      | What it does                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /notifications`             | `list_notifications`          | Newest first, `limit` (1–100, default 20), keyset `cursor` from `next_cursor`. By default the in-app ones; `push_only=true` lists those meant for push whatever their in-app switch. `unread_only` and `after` (ISO time, strictly after) narrow it, which is what a device poller uses with its high-water mark. `unread_count` always counts every unread in-app notification |
| `POST /notifications/:id/read`   | `mark_notification_read`      | Mark one read; an already read one keeps its first `read_at`                                                                                                                                                                                                                                                                                                                    |
| `POST /notifications/read-all`   | `mark_all_notifications_read` | Mark every unread one read; returns how many                                                                                                                                                                                                                                                                                                                                    |
| `GET /notifications/types`       | `list_notification_types`     | The types this user can receive, with label, description and both switches                                                                                                                                                                                                                                                                                                      |
| `PUT /notifications/types/:type` | `set_notification_preference` | Body `{ in_app?, push? }` (at least one); 404 for an unknown type or an admin-only one for a non-admin                                                                                                                                                                                                                                                                          |

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
   `packages/api-spec/src/schemas/notifications.ts` (`admin_only` if only admins should get it).
2. Rebuild and regenerate: `pnpm --filter @aurboda/api-spec build`, then
   `cd packages/api-spec && pnpm generate`.
3. Raise it where the event happens:

   ```ts
   import { notifier } from "../services/notifications.ts";

   await notifier.raiseBestEffort(user, {
     type: "my_type",
     title: "Short headline",
     body: "Optional details",
     link: "/in-app/path",
     dedupe_key: "my_type:<something unique>",
   });
   ```

   `raiseBestEffort` logs and swallows any error, so it is safe on a hot path; `raise` throws and
   returns the stored row. Give a `dedupe_key` to anything a recurring job raises, so the same
   event is stored once however often the job sees it.
