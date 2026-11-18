# Strength references: where the numbers come from

`strength-references.json` holds the reference lifts of the strength score: which catalogue
exercises count as which lift, the muscle group each lift scores, and per sex the one-rep max that
scores 100 points, as a multiple of bodyweight. See
[docs/features/strength-score.md](../../../../../docs/features/strength-score.md) for how the score
is computed from it.

The file is Aurboda's own, written by hand. Nothing in it is taken from another app, site or
published table of strength standards.

- **What 100 points means:** a solid recreational lifter, someone who has trained the lift
  regularly for a year or two. The ratios are estimates of that level, set lift by lift and kept
  consistent with each other (a dumbbell bench press per dumbbell is 0.4 of a barbell bench press,
  an incline press a little under a flat one). They are a yardstick for following one's own
  progress, not a standard to be ranked against.
- **`ratio`:** the reference one-rep max divided by bodyweight, for a bodyweight of
  `reference_bodyweight_kg`. At another bodyweight the reference is
  `ratio × reference_bodyweight_kg × (bodyweight / reference_bodyweight_kg) ^ bodyweight_exponent`,
  so it grows slower than bodyweight does.
- **Dumbbell lifts** are given per dumbbell, the way a set is logged: 12 kg means one 12 kg
  dumbbell in the hand, or one in each. The two-hand triceps extension and the goblet squat hold
  one weight in both hands.
- **Only free-weight lifts** are listed. A machine's or a cable stack's numbers differ from one make
  to the next, and a bodyweight exercise has no logged weight to estimate a one-rep max from.
- **The weighted single-leg glute bridge** is the one bodyweight exercise listed: its catalogue
  entries carry no equipment, and a set scores only when it has a logged weight. That weight is the
  load lying on the hip, the same whether it is a kettlebell, a dumbbell, a plate or a barbell. The
  ratio comes from the barbell glute bridge: the hips lift the bar plus roughly 0.45 of the body,
  one leg manages about half of that, and about half the bodyweight is the leg's own share.
- **Left out on purpose:** the kettlebell swing, which is ballistic, so its weight and reps say
  little about maximal strength; and the two-leg glute bridge or hip thrust with a kettlebell or a
  dumbbell, where the weight that can be held is far below what the glutes can lift.
- **`keys`** are keys of `../exercises/exercise-catalog.json`. A key belongs to one lift, and every
  entry listed trains one of the lift's group's `muscle_groups` at a recruitment weight of 0.5 or
  more; a test holds both.

Changing a ratio moves every user's score and its history, since nothing is stored: raise `version`
and say so in the release notes.
