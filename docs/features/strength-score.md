# Strength score

The strength score turns the sets of a strength type (`strength_training`'s `sets`, or any activity
type with a [catalogue-backed item path](activity-types.md#exercise-identities)) into points: one
per reference lift, one per muscle group and one overall. 100 points is the reference, a solid
recreational lifter who has trained the lift regularly for a year or two.

It is a yardstick for following one's own progress, not a standard to be ranked against: the
references are Aurboda's own estimates, and the score leaves out age, limb length, technique and
everything else that sets one lifter apart from the next. It is computed on read and never stored,
so it and its history always follow the data as it is now (a corrected set, a newly matched
exercise, a changed weight).

## How it is computed

1. **Which sets count.** Working sets (warm-ups are out) with a logged weight above 0 and at least
   one rep, of an exercise whose name resolves to a [catalogue entry](exercise-catalog.md) that is one
   of a reference lift's entries. Names resolve the way muscle groups do, through the user's
   [exercise identities](activity-types.md#exercise-identities), so a name mapped by hand counts
   too. A set's time is its session's start.
2. **Estimated one-rep max (e1RM)**, Epley: `weight × (1 + reps / 30)`, with the reps capped at 12
   because the estimate gets poor above that: a set of 17 reps scores as one of 12 with the same
   weight. That cap is where it differs from the `e1rm` measure of the exercise page, which is not
   capped. Dumbbell lifts count the weight of one dumbbell, as it is logged.
3. **Reference.** `ratio × 75 × (bodyweight / 75) ^ 0.67`, where `ratio` is the lift's reference
   one-rep max as a multiple of bodyweight at 75 kg, by sex. The reference grows slower than
   bodyweight does. The bodyweight of a set is the latest value of the `weight` metric at or before
   its session, or the earliest after it when there is none before.
4. **Lift score.** `100 × e1RM / reference` of the lift's best set in the 90 days up to the moment
   scored (more than 90 days before it is out): the set with the most points, and the later one on
   a tie. Whole points. The set leaves the window 90 days after its session (`expires_at`); a lower
   set may take its place then.
5. **Group score.** The mean of the group's best three lift scores, fewer when fewer lifts have a
   score; none without any.
6. **Overall score.** The mean of the group scores there are.

The means are taken over the unrounded points and rounded only at the end.

A worked example: a man of 80 kg benches 80 kg for 5 reps. The e1RM is `80 × (1 + 5/30)` = 93.3 kg.
The reference is `1.0 × 75 × (80/75) ^ 0.67` = 78.3 kg, so the lift scores `100 × 93.3 / 78.3` = 119. If he also curls 30 kg for 8 reps on the barbell, the e1RM is 38 kg against a reference of
`0.45 × 75 × (80/75) ^ 0.67` = 35.2 kg: 108 points. With no other chest or biceps lift, the chest
scores 119, the biceps 108 and the overall score is their mean, 114.

## Groups and lifts

| Group      | Lifts                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chest      | Barbell bench press, Incline barbell bench press, Dumbbell bench press, Incline dumbbell press                                                         |
| Shoulders  | Barbell overhead press, Dumbbell shoulder press, Arnold press, Dumbbell lateral raise                                                                  |
| Back       | Barbell row, Dumbbell row                                                                                                                              |
| Biceps     | Barbell curl, EZ-bar curl, Dumbbell curl, Incline dumbbell curl, Hammer curl                                                                           |
| Triceps    | Close-grip bench press, EZ-bar skullcrusher, Lying dumbbell triceps extension, One-arm dumbbell triceps extension, Two-hand dumbbell triceps extension |
| Quadriceps | Back squat, Front squat, Goblet squat, Dumbbell split squat, Dumbbell lunge                                                                            |
| Hamstrings | Romanian deadlift, Stiff-legged deadlift, Dumbbell Romanian deadlift                                                                                   |
| Glutes     | Deadlift, Barbell hip thrust, Barbell glute bridge, Dumbbell deadlift, Weighted single-leg glute bridge                                                |

The single-leg glute bridge is a bodyweight exercise in the catalogue ("Single Leg Glute Bridge",
"Single-leg Hip Raise"): a set scores only when it has a logged weight, the load lying on the hip,
whether that is a kettlebell, a dumbbell, a plate or a barbell.

The ratios, the catalogue entries that count as each lift and where the numbers come from are in
`apps/backend/src/catalog/strength/strength-references.json` and its `NOTICE.md`.

## What it needs

- **Sex** in the user settings (the references differ by sex).
- **A bodyweight**: at least one value of the `weight` metric.
- **Exercises matched to the catalogue**: a name that resolves to no entry, or to an entry that is
  no reference lift's, does not count.

Without sex or a bodyweight, `missing` lists `sex` and/or `bodyweight`, every score is `null` and
the history has no points; each lift's best set (by e1RM) is still given, without its reference.

## In the web app

- **The score page** (`/activity-type/<type>/strength-score/<item path>`, for strength training
  `/activity-type/strength_training/strength-score/sets.exercise`): the overall score with its
  change over the last 30 days, the score over time (overall or one muscle group, over 90 days, a
  year or three years) and, per group, the lifts done in the last 90 days with the set each is
  scored on, its estimated one-rep max, the weight that would score 100 points and whether it
  counts toward the group. A lift whose best set leaves the 90 days within two weeks says so. The
  reference lifts not done are listed under each group. Without sex or a bodyweight the page says
  what to add and still lists the best sets. Beside the score cards, a **Strongest and weakest**
  card names the highest and lowest scored groups (`Triceps 128 · Quadriceps 93`) once at least
  two groups have a score and they differ.
- **Strength page, Progress tab** (`/strength/progress`): the score page's content for strength
  training, under the Strength page's tabs.
- **Type page**: a "Strength score" section above "Sets per muscle group".
- **Muscle group page**: the group's score as a card and its score over the period chosen on the
  page (the Back score on the Lats and Middle back pages).

The Android app shows the same pages, embedded.

## REST and MCP

| REST                                               | MCP                          |
| -------------------------------------------------- | ---------------------------- |
| `GET /activity-types/:name/strength-score`         | `get_strength_score`         |
| `GET /activity-types/:name/strength-score/history` | `get_strength_score_history` |

- `GET /activity-types/:name/strength-score?field=sets.exercise&at=` is the score at `at` (ISO
  8601, default now) over the sessions of the type and its subtypes: `score`, `missing`,
  `window_days` and `groups`, every group in a fixed order with its `score`, `muscle_groups` and
  `lifts`. Every reference lift is listed, those with a best set first (most points first), each
  with its `score`, whether it is `counted` in the group's score, its `catalog_keys`, its `best`
  set (the exercise as logged, its catalogue key, weight, reps, e1RM, bodyweight, reference e1RM,
  session and start time) and `expires_at`.
- `GET /activity-types/:name/strength-score/history?field=sets.exercise&start=&end=&step_days=` is
  the score at `end` (default now) and every `step_days` (1 to 31, default 7) before it down to
  `start` (default 365 days before `end`), oldest first. Each point carries the overall `score` and
  the `groups` that have a score, each looking back over its own 90 days. A `start` not before
  `end`, or a period of more than 500 points, is a 400.

A field that is not a catalogue-backed item path of the type is a 400, an unknown type a 404. The
MCP tools take the same parameters plus `activity_type`.

## Limits

- Free-weight lifts only: a machine's or a cable stack's numbers differ from one make to the next,
  and a bodyweight exercise has no logged weight to estimate from (the single-leg glute bridge
  counts with an added weight).
- No score for the abdominals, calves, forearms or neck.
- No adjustment for age.
