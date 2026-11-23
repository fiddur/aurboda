# Strength plans

A strength plan is a strength workout written down ahead of time: a name, an optional note, and the
planned sets in the order to do them. The user, or an assistant working for them over MCP, writes
it; the [strength logging](strength-logging.md) Workouts tab lists the plans and starts a live
session from one, prefilled with the planned sets.

## Day or saved workout

- **With a day** (`planned_for`, `YYYY-MM-DD`): a workout to do once. It is a calendar day, not a
  moment, so no time zone ever moves it. Once a session has been started from it, the plan is
  done.
- **Without a day**: a routine, shown in the web app as a **saved workout**, started whenever and
  any number of times. A routine is never done.

## Sets

Each planned set has the item fields of a logged strength set: `exercise` (required), and as needed
`reps` or `time` (seconds), `weight` (kg; for a dumbbell exercise the weight of one dumbbell, as
sets are logged), `set_type` (`normal`, `warmup`, `drop_set`, `failure`) and a `note` as a cue.
Consecutive sets of one exercise form a block, as on the logging pages. At most 200 sets.

`exercise_key` may name an entry of the [exercise catalogue](exercise-catalog.md); a key the
catalogue does not have is refused (`sets[2].exercise_key: unknown exercise catalogue key "…"`).
The sets are stored as given: names are not normalised against aliases, since the sets logged
from the plan go through the normal activity write.

## Muscle groups

Every plan answer carries `muscle_groups`: the muscle groups its exercises mainly work, in the order
they first appear in the plan, without duplicates. A set with an `exercise_key` uses that catalogue
entry; a set without one is matched by its name, as the muscle group pages match logged sets (the
user's own mapping for `sets.exercise`, else an exact catalogue name or alias). An exercise mainly
works a group when its weight for the group is at least 0.75 (`EXERCISE_PRIMARY_MUSCLE_WEIGHT`,
the same threshold as the primary muscles of an exercise page). Sets matched to no entry add
nothing, so a plan of unmatched exercises has an empty list. It is computed on every read, not
stored.

## Sessions started from a plan

Which sessions came from a plan is not stored on the plan. A strength activity started from a plan
carries the plan's id in its `data.plan_id`; a plan's `sessions` are the activities that are not
deleted and carry its id, newest first, each with `activity_id` and `start_time`. Deleting a plan
deletes only the plan; its sessions keep their `plan_id`.

Lists default to the **open** plans: routines, and plans with a day that have no session yet.
`status=all` adds the done ones. Plans with a day come first, earliest day first, then routines by
name (case-insensitive); ties by creation.

## In the web app

- **Strength page, Workouts tab** (`/strength/workouts`, see [strength
  logging](strength-logging.md#the-workouts-tab)): "Planned" lists the open plans with a day (a day
  that has passed is marked), "Saved workouts" those without one with when each was last done; each
  card has a readiness line for its `muscle_groups`, **Start** and **Edit**, and a "Plan a workout"
  link sits on the first heading. Without any open plan the tab says so, with the link.
- **Muscles tab** (`/strength`): a "Planned today" card for each plan for today, with **Start**.
- **Start** opens the live session (`/strength/live?plan=<id>`) with the planned sets prefilled
  block by block, as Repeat does with an earlier session. The session carries the plan's id from
  its first save, after which the start page no longer lists a plan with a day as open. A planned
  set's type is preselected and logged with the set unless changed, and its note shows under the
  planned line as a cue without being copied onto the logged set. The live session shows the plan's
  name and note at the top, read from the plan (also after a reload; nothing of it is stored on the
  activity, and nothing shows once the plan is deleted). A plan that cannot be loaded opens an
  empty session with "That plan no longer exists. Starting an empty session."
- **The plan page** (`/strength/plan/new`, `/strength/plan/<id>`): name, day, note and the sets,
  in the same block editor as a past session, with the sessions done from the plan and Delete.
- **Save as a workout** (`/strength/plan/new?from=<activity id>`, from a row of Recent sessions):
  the plan page titled "Save as a workout", its blocks filled from that session's sets and the name
  empty and focused. Nothing is created until Save. On Save, when the session was logged in
  Aurboda on its own (not synced, merged or an override) and has no `plan_id` yet, its
  `data.plan_id` is set to the new plan, so the row says "Saved as {name}" and the saved workout
  "Last done"; a failure there is ignored and the plan stays saved. A session that cannot be loaded
  shows "That session could not be loaded." over an empty form.

The Android app shows the same pages, embedded.

## REST

| Method and path              | What it does                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `GET /strength-plans`        | List plans; `status` is `open` (default) or `all`                                                                             |
| `POST /strength-plans`       | Create a plan from `name`, `sets` and optional `planned_for` and `note`; answers 201                                          |
| `GET /strength-plans/:id`    | One plan with its sessions and `muscle_groups`; 404 `Plan not found`                                                          |
| `PATCH /strength-plans/:id`  | Change it: a field left out stays, `planned_for: null` and `note: null` clear, `sets` replaces the list; an empty body is 400 |
| `DELETE /strength-plans/:id` | Delete it                                                                                                                     |

## MCP

`list_strength_plans` (`status`), `get_strength_plan` (`id`), `create_strength_plan` (`name`,
`sets`, `planned_for`, `note`), `update_strength_plan` (`id` and the fields to change, as the
PATCH, except that an empty string instead of `null` clears `planned_for` or `note`) and
`delete_strength_plan` (`id`).

## Letting an assistant plan

The user's own instructions for how to plan (goals, split, how hard to go) stay with the
assistant; nothing of them is stored here. With them, an assistant combines:

1. `get_muscle_recovery`: which muscle groups are ready (80 and above), also at a later `at` for
   the day of a plan ahead.
2. `get_strength_score`: the best recent sets per reference lift, to pick weights.
3. `get_activity_item_history` or `query_activities`: what was done last time.
4. `list_activity_field_values` (`field: "sets.exercise"`): the user's own exercise names, used
   first so the history continues; otherwise `search_exercise_catalog` (with `muscle` for the
   ready groups) for a catalogue name and its key as `exercise_key`.
5. `list_strength_plans`: not to plan the same workout twice.
6. `create_strength_plan`: the plan, which then waits on the strength start page.
