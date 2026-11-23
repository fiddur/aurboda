# Reminders

A reminder is a recurring nudge you set up yourself: "Evening questionnaire" at 20:00 every day,
"Stretch" at 07:30 on weekdays. When one is due the server raises a [notification](notifications.md)
of type `reminder`, so it shows under the 🛎 bell and, with the Android app, on the phone. Tapping
it opens the page you chose for it, if any. Reminders add no delivery path of their own: they ride
on notifications, and the type's in-app and push switches in Settings → **Notifications**
(group **Reminders**) apply to them like to any other type.

## Model

Reminders live in the user's own database, table `reminders`: `title`, optional `body` and `link`
(an in-app path such as `/reports`), `time_of_day` (`HH:MM` in five-minute steps), `weekdays` (ISO
weekdays, 1 = Monday … 7 = Sunday, stored sorted and unique), `enabled`, and `not_before`, the
instant before which no occurrence is raised.

## When a reminder fires

Times are read in the user's time zone (`tz` in the user settings, stored as `device_timezone`;
UTC when unset). The web sets it from the browser the first time a signed-in page loads without
one, and Settings → Time zone (`/settings#time-zone`) changes it; `PATCH /user/settings { "tz":
"Europe/Stockholm" }` or the `update_user_settings` MCP tool do the same, and `"tz": null` clears it.
The Android app also writes the phone's zone each time it syncs Health Connect, and the last writer
wins: a zone chosen in Settings is replaced by the phone's at its next sync. A reminder has an occurrence on each local date whose weekday it lists, at `time_of_day`
on that date. A time skipped by the spring-forward clock change moves to the instant the clocks
jump (02:30 becomes 03:00); a time that happens twice in the autumn uses the first.

A five-minute job (pg-boss queue `reminder-scheduler`, its own queue so the slower provider sync
tick never makes it late) walks every user and raises each occurrence that is **due**: its time
has passed by less than an hour, and it is not before `not_before`. So:

- **Skipped after an hour.** An occurrence more than an hour overdue (the server was down) is not
  raised late; the next one is.
- **Starts tomorrow.** Creating a reminder, changing its time or days, or switching it back on sets
  `not_before` to now: a time that has already passed today is not raised until the next matching
  day. Editing only the name, text or page leaves it.

Each occurrence is raised once, whatever the ticks or instances: its notification's dedupe key is
`reminder:<id>:<local date>`, and its `data` carries `reminder_id` and `occurrence_date`. While an
occurrence is due, the earlier unread notifications of the same reminder are marked read, so a
reminder you did not get to does not pile up. Notifications already raised stay when a reminder is
edited or deleted.

`next_due_at` on a reminder is the next instant it will raise (null when switched off); the list
also carries the earliest of them and the time zone.

## Web

`/reminders` (under **Setup** in the menu, and linked from the `/notifications` header) lists the reminders with their schedule
("Every day at 20:00", "Weekdays at 07:30", "Mon, Wed, Fri at 07:30"), the page each opens, an on/off
switch, **Edit** and **Delete**. The form asks for a name, optional text, a time (a time off the
five-minute grid is rounded to the nearest step), the days (all on by default), and the page to
open: none, one of the app's pages, or another in-app path.

## Android

The app opens the same page from **More → Inbox → Reminders**. Its notification poll runs every 15
minutes, which would make a reminder up to 15 minutes late, so after each poll it reads
`GET /reminders` and schedules one extra poll a minute after `next_due_at`. See
[Android app](../android-app.md#notifications).

## API

| Route                    | MCP tool          | What it does                                                                                                             |
| ------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /reminders`         | `list_reminders`  | The reminders with `next_due_at` each, the earliest `next_due_at`, and `timezone`                                        |
| `POST /reminders`        | `add_reminder`    | Body `{ title, body?, link?, time_of_day, weekdays?, enabled? }`; `weekdays` defaults to every day and `enabled` to true |
| `PATCH /reminders/{id}`  | `update_reminder` | Any of those fields, at least one; `body` and `link` take null to clear. 404 for an unknown id                           |
| `DELETE /reminders/{id}` | `delete_reminder` | Delete one; 404 for an unknown id                                                                                        |

`link` must be an in-app path: it starts with `/` and not `//`, at most 500 characters. `title` is
1–120 characters after trimming, `body` at most 500.
