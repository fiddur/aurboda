# People

A person is your own private profile of someone in your life: a partner, a child, a parent, a
friend. It holds their name, how they relate to you, their birthday, their pronouns, the other dates
that matter about them (an anniversary, the day someone passed away), your [notes](comments.md)
about them, and which activities you did with them. Most people in it have no account anywhere;
for those who do, a profile can also carry their fediverse handle.

## Privacy

A profile never leaves your account. Nothing about it is federated or public: there is no route
to it but the authenticated owner's own API, it is not in shared dashboards, and the people an
activity was with are dropped from every share of that activity (the feed post, its structured
payload and AS2 object, a shared dashboard's day overview, article exports). The account export
(`pg_dump`) carries the tables like every other.

The one exception is a mention you switch on when sharing an activity: a person with a fediverse
handle who was with you can be mentioned, which publishes their account and handle ("with
@anna@example.social") and nothing else about them or anyone else. It is off every time, and an
auto-share rule never mentions anyone. See
[Mentioning people](sharing.md#mentioning-people-in-an-activity-share).

## On the web

**People** (`/people`, in the main menu and the app's More → Log) lists everyone by name with
their relationship, their next date and, with a handle, their avatar. **Upcoming dates** on top
are the next 60 days ("Anna's birthday", "Tuesday 3 December · in 12 days · turns 40"), each
opening the person. A filter box shows once there are more than ten people, **Show archived**
adds the archived ones, **Add person** opens the form, and **Recently deleted** at the bottom
restores a deleted person within its 30 days.

A person's page (`/people/<id>`) shows their details with **Edit** (name, relationship with the
suggestions, birthday as day and month with an optional year and "remind me N days before",
pronouns, fediverse handle, archived), their **Dates** (add, edit, delete), **Notes** (the
[comment](comments.md) thread on the person), the **Activities together** with a link to the
time with them in Analyze, and with a handle the account's name and a **Follow** button when
you do not follow it, and their **Recent posts** from your feed. The handle can be typed (a
handle that does not resolve shows the server's message) or picked from the accounts you
follow that no person has yet. **Delete** goes back to the list with "Deleted … Undo" for ten
seconds.

The activity forms (Add Data, and Edit on an activity's page; the Timeline's "Add activity"
opens Add Data) have a **With** picker: type a name, pick from your people, and remove a chip
to unlink. Below your people it offers the followed accounts that have no profile yet
("@anna@example.social: add as a person"), which adds the person with that handle and picks
them, and a name nobody has yet can be added as a person from there too. An activity's page lists **With** Anna, Bo, each linking to the person.

Sharing an activity can mention the people with a handle, off every time: see
[Mentioning people](sharing.md#mentioning-people-in-an-activity-share). Their dates are
markers on the [Timeline](timeline.md).

The app's native Add tab has no With picker yet; add or edit the activity on the web to link
people.

## In Analyze

Time with people is a correlation selector (with anyone, or with one person), and **With** is a
breakdown and filter of an activity's sessions, both private to you: see
[Time with people](correlations.md#time-with-people). In Explore it is the **time with
people** kind (with anyone, or a person by name), offered in Continuous mode; an article refuses
the selector, so the article editor does not offer it.

## A person

| Field                         | What it is                                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `name`                        | 1 to 120 characters, trimmed                                                                                           |
| `relationship`                | Free text up to 60 characters; the list answer suggests `partner`, `child`, `parent`, `sibling`, `friend`, `colleague` |
| `birth_date`                  | `YYYY-MM-DD`, or `--MM-DD` when the year is not known; a real date (29 February is allowed without a year)             |
| `birthday_notify_days_before` | 0 to 60: raise an `important_date` notification that many days before the birthday; null for none                      |
| `pronouns`                    | Up to 40 characters                                                                                                    |
| `archived`                    | Left out of the list (unless asked for) and of the important dates                                                     |
| `actor`                       | The fediverse account, when the person has a handle (see below)                                                        |

An empty `relationship` or `pronouns` is stored as none; `null` clears any of the optional fields.

## The fediverse handle

A body may carry `handle` (`@name@server` or `name@server`). It is resolved the way a
[follow](feed.md) resolves one (WebFinger and the actor document, through Fedify), and only the
actor's URI is stored: the handle is never what identifies the person, and `handle: null` clears
it. A handle that does not resolve is a `400` with the message a follow gives. At most one live
profile has a given account: a second one is a `409` naming the person who has it.

`actor` in an answer is `{ uri, handle, name, icon, following }`, read when the answer is built:
from your follow of that account when there is one (`following` is whether the follow was
accepted), else from the newest post by it in your timeline, else from a small cache written when
the handle was set and refreshed when a person's page is read and the other sources are newer. A
list never makes a network call.

With a handle, `GET /people/{id}/posts` lists the person's recent posts from your own timeline,
newest first (only what you already received from their account; nothing is fetched): `limit`
defaults to 20, at most 50, and each post has the timeline's own shape. Without a handle it is a
`404`.

## Deleting

Deleting a person is recoverable, by the rule that anything taking more than a few seconds to make
again can be brought back: `DELETE /people/{id}` sets `deleted_at`, and the person is gone from
everywhere (lists, important dates, the people of every activity, notifications) while their
dates, activity links and notes stay stored. `POST /people/{id}/restore` brings it all back; it is
refused with a `409` while another live profile has the same account. `GET /people?deleted=true`
lists what can still be restored, with `deleted_at` and `purge_at`. The daily prune pass removes a
person deleted more than 30 days ago for good, with their dates, links and notes;
`DELETE /people/{id}?purge=true` does that at once.

A single date is cheap to type again and is deleted outright.

## Dates and notifications

A date has a `label`, a `kind` (`birthday`, `anniversary`, `remembrance`, `other`; default
`other`), a `month` and `day`, an optional `year`, and an optional `notify_days_before` (0 to 60).
A person's birthday is listed from their `birth_date`, with no date row of its own.

`GET /people/dates?from&to` lists every occurrence between `from` and `to` (`YYYY-MM-DD`, at most
400 days apart; default today to 60 days on, in your time zone) of the dates and birthdays of the
live, non-archived people, by date. Each has `person: { id, name }`, `date_id` (null for a
birthday), `label` ("Anna's birthday" for a birthday), `kind`, `date`, and `years` (the age, or
years since) when the year is known and the count is positive. 29 February falls on 28 February in
other years.

A date with `notify_days_before` (and a birthday with `birthday_notify_days_before`) raises an
[`important_date` notification](notifications.md) on the local day that many days before each
occurrence, from 08:00 in your time zone until the end of that day, from the five-minute reminder
tick (its own step next to the [reminders](reminders.md), so one failing leaves the other). The
title says what and when, "Anna's birthday is in 3 days (turns 40)", "Anna: Wedding anniversary
is tomorrow (12 years)", and the notification opens `/people/{id}`. Each occurrence is raised once:
the dedupe key is `important_date:<date id or birthday:<person id>>:<occurrence>`.

## Who an activity was with

`people` (person IDs, at most 20, unique) on `POST /activities` and `PATCH /activities/{id}` (MCP
`add_activity`, `update_activity`) says who an activity was with. On an update it replaces the set,
`[]` clears it, and leaving it out leaves it. An unknown, deleted or malformed ID is a `400` naming
it. A change of only `people` on a synced activity links them to it without creating an override.

Activity reads (`GET /activities`, `GET /activities/{id}`, `GET /activities/{id}/full`,
`query_activities`, `get_activity_detail`) carry `people: [{ id, name }]` of the live people,
resolved when read (a renamed person shows their new name), and leave it out when there is none. A
merged view is with everyone its sources were with. Merging activities gives the merged one the
union of the links; a soft-deleted activity keeps its links and gets them back when restored.
`GET /people/{id}` lists the 20 latest live activities the person was with.

## Notes about a person

A comment can be about a person: `entity_type: person` with the person's ID (see
[Comments](comments.md)). It has no time, so it is not on the Timeline or in search; it is read
through the person (`GET /notes?entity_type=person&entity_id=…`). A note about an unknown or
deleted person is refused as not found.

## API

| Route                                 | MCP tool               | What it does                                                                        |
| ------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------- |
| `GET /people`                         | `list_people`          | The people by name; `archived=true` includes archived, `deleted=true` lists deleted |
| `POST /people`                        | `add_person`           | Add a person                                                                        |
| `GET /people/{id}`                    | `get_person`           | The person with `dates` and `recent_activities`                                     |
| `PATCH /people/{id}`                  | `update_person`        | Change the given fields                                                             |
| `DELETE /people/{id}`                 | `delete_person`        | Delete, restorable for 30 days; `purge` removes it for good                         |
| `POST /people/{id}/restore`           | `restore_person`       | Restore a deleted person                                                            |
| `GET /people/{id}/posts`              | `list_person_posts`    | The person's posts from your timeline                                               |
| `GET /people/{id}/dates`              | `get_person` (`dates`) | The person's dates                                                                  |
| `POST /people/{id}/dates`             | `add_person_date`      | Add a date                                                                          |
| `PATCH /people/{id}/dates/{date_id}`  | `update_person_date`   | Change a date; `year` and `notify_days_before` take null to clear                   |
| `DELETE /people/{id}/dates/{date_id}` | `delete_person_date`   | Delete a date for good                                                              |
| `GET /people/dates`                   | `list_important_dates` | Occurrences of every date and birthday in a window                                  |

Unknown or deleted people and dates are `404`s.
