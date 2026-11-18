# Muscle recovery

Muscle recovery says, per muscle group, how far the fatigue of the last days has worn off: 100 is
fully recovered, 80 and above is ready to train, lower means the group is still tired from recent
sessions. It is read from the sets of a strength type (`strength_training`'s `sets`, or any
activity type with a [catalogue-backed item path](activity-types.md#exercise-identities)), to plan
the next workout by: a person, or an assistant through MCP, picks the groups that are ready.

It is a model, not a measurement. It knows only the strength sets logged, and nothing of how the
body actually feels. It is computed on read and never stored, so it always follows the data as it
is now.

## How it is computed

1. **Which sets count.** Every working set (warm-ups are out) of a session of the type or its
   subtypes started in the 10 days up to the moment asked about, whose exercise name resolves to a
   [catalogue entry](exercise-catalog.md), the same way [muscle groups](activity-types.md#muscle-groups)
   resolve it. Weight and reps are not needed: a hold or a bodyweight set tires the muscle too.
2. **Recruitment.** A set counts toward every muscle group the entry trains, by its recruitment
   weight: within one group the highest weight of the entry's muscles in it (a bench press set is 1
   for the chest and 0.5 for the shoulders).
3. **Effort.** From the set's own fields: 1.2 when `set_type` is `failure`, `rpe` is 9 or more or
   `rir` is 1 or less; 0.7 when `rpe` is 6 or less or `rir` is 4 or more; otherwise 1. A set that is
   both counts as hard.
4. **Fatigue.** Each set adds `0.1 × recruitment × effort` to the group: ten full sets make a
   fatigue of 1.
5. **Decay.** That fatigue halves every half-life of the group, counted from the end of the
   session: its end time, or for a session still in progress the time of its last set (its start
   when there is none). A session that ends after the moment asked about counts in full.
6. **Recovery.** `100 × (1 − fatigue)` of the summed fatigue, from 0 (a fatigue of 1 or more) to
   100, rounded to a whole number. `ready_at` is when the group reaches 80 if nothing more is
   trained (`now + half_life × log2(fatigue / 0.2)` hours), `null` when it already has.

### Half-lives

| Muscle groups                                                                               | Half-life |
| ------------------------------------------------------------------------------------------- | --------- |
| Chest, lats, middle back, lower back, quadriceps, hamstrings, glutes                        | 36 hours  |
| Shoulders, traps, biceps, triceps, forearms, abdominals, abductors, adductors, calves, neck | 24 hours  |

### A worked example

A session ends Monday at 18:00 with four sets of barbell bench press, three at RPE 8 and the last
to failure. The chest gets `3 × 1 + 1.2` = 4.2 weighted sets, a fatigue of 0.42; the shoulders
half of that, 0.21.

On Tuesday at 08:00, 14 hours later, the chest has `0.42 × 0.5 ^ (14 / 36)` = 0.32 left: recovery
68, ready at `18:00 + 36 × log2(0.42 / 0.2)` = 38.5 hours, Wednesday at about 08:30. The shoulders
have `0.21 × 0.5 ^ (14 / 24)` = 0.14 left: recovery 86, ready since Monday evening.

## What it leaves out

- Training other than the strength sets logged: running, cycling and other activity types.
- Sleep, HRV, soreness and how the body feels.
- Exercises not matched to the catalogue, which train no known group.
- Any manual correction: the recovery is what the model gives.

## In the web app

- **Strength start page** (`/strength`): a "Muscle recovery" card with the groups below 80, the
  most tired first, each with its percentage, a bar (orange from 50, red below) and when it is
  ready ("Ready in 5 h", "Ready tomorrow"), and a line counting the groups that are ready.
- **Exercise picker**: the muscle group filter shows the recovery next to every group below 100
  ("Chest · 64 %").
- **Type page**: a "Muscle recovery" section with every group below 100 (green from 80), above
  "Sets per muscle group".
- **Muscle group page**: a Recovery card, and a Recovery section with the group's curve over the
  period chosen on the page (every 6 hours over 90 days, one point a day at the end of the day over
  1 and 2 years) and the sessions it is still tired from.

The Android app shows the same pages, embedded.

## REST and MCP

| REST                                                       | MCP                           |
| ---------------------------------------------------------- | ----------------------------- |
| `GET /activity-types/:name/muscle-groups/recovery`         | `get_muscle_recovery`         |
| `GET /activity-types/:name/muscle-groups/recovery/history` | `get_muscle_recovery_history` |

- `GET /activity-types/:name/muscle-groups/recovery?field=sets.exercise&at=` is the recovery at
  `at` (ISO 8601, default now; a later moment gives the recovery expected then): `ready_percent`
  (80), `window_days` (10) and `groups`, every muscle group of the catalogue in catalogue order with
  its `name`, `recovery`, `fatigue` (2 decimals, not capped), `half_life_hours`, `ready_at` and
  `sources`, the at most five sessions with the most fatigue left for it, most first, each with
  its weighted `sets`, the `fatigue` left, its start and the `end_time` the fatigue is counted
  from.
- `GET /activity-types/:name/muscle-groups/recovery/history?field=sets.exercise&start=&end=&step_hours=`
  is the recovery of every group at `end` (default now; it may lie ahead) and every `step_hours`
  (1 to 24, default 6) before it down to `start` (default 14 days before `end`), oldest first. A
  `start` not before `end`, or a period of more than 1000 points, is a 400.

A field that is not a catalogue-backed item path of the type is a 400, an unknown type a 404. The
MCP tools take the same parameters plus `activity_type`. To find exercises for a group that is
ready, `search_exercise_catalog` takes the group as `muscle`.
