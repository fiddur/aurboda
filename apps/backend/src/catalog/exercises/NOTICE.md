# Exercise catalogue: sources and attribution

`exercise-catalog.json` is built from two open datasets and Garmin Connect's exercise list by the scripts in `build/`. See
[docs/features/exercise-catalog.md](../../../../../docs/features/exercise-catalog.md) for how.

## body.build

- URL: https://github.com/Dieterbe/body.build
- Files: `lib/data/dataset/ex.dart`, `volume_assignment.dart`, `tweak.dart`, `equipment.dart`,
  `program_group.dart`
- Commit: `4d8bbcc5ccea4d6802ee373a0be1aa5f5dcc8dd6`
- License: AGPL-3.0, by the body.build authors
- Taken: exercise ids, equipment, the recruitment weight of each program group, and the search
  aliases. The weights are the numbers of the `Assign(...)` entries in an exercise's volume
  assignment, overlaid in order with the volume assignment of each of its tweaks' default option
  (later entries win per program group, zero weights are dropped). The cardio block (`cycling` to
  the end of the list) is left out, as are ratings, descriptions, modality strings, the other tweak
  options and their descriptions, and tweak constraints.
- Changed: converted from Dart to JSON (`sources/bodybuild.json`); program groups and equipment mapped to
  Aurboda's vocabulary; display names and keys derived from the ids (title case, the typo `smitch`
  corrected to `Smith` in the display name only); entries merged with free-exercise-db where
  `links.json` links them; equipment replaced where `links.json` overrides it (`pull_up`,
  `barbell_squat`, `cable_deadlift`).

## free-exercise-db

- URL: https://github.com/yuhonas/free-exercise-db
- File: `dist/exercises.json`
- Commit: `f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5`
- License: Unlicense (public domain)
- Taken: id, name, equipment, primary and secondary muscles, category. Entries in the `cardio` category
  are left out, as are instructions, images, level, force and mechanic.
- Changed: trimmed to those fields (`sources/free-exercise-db.json`); muscles, equipment and categories
  mapped to Aurboda's vocabulary (primary muscle weight 1, secondary 0.5; `strongman`, `powerlifting`
  and `olympic weightlifting` become `strength`); keys derived from the names; entries merged with
  body.build where `links.json` links them, the free-exercise-db name then becoming an alias.

## Garmin Connect exercise list

- URLs: https://connect.garmin.com/web-data/exercises/Exercises.json and
  https://connect.garmin.com/web-translations/exercise_types/exercise_types.properties
- Fetched: 2026-11-13
- License: none stated
- Taken: the category and exercise identifiers (those of the FIT profile), as lower-case FIT keys
  `<category>/<name>`, and the English display names (`sources/garmin.json`). Not taken: the primary
  and secondary muscles, or anything else of an exercise.
- Changed: the categories `RUN`, `RUN_INDOOR`, `BIKE_OUTDOOR`, `INDOOR_BIKE`, `ELLIPTICAL`,
  `STAIR_STEPPER`, `FLOOR_CLIMB` and `CARDIO` left out; exercises that are the same as a body.build or
  free-exercise-db entry merged into it, their names becoming aliases where they differ; "Weighted" variants merged into
  the entry of the unweighted exercise; two names overridden (`crunch/flutter_kicks` to "Supine
  Flutter Kicks", `sled/pull` to "Sled Pull"); muscles and equipment of the Garmin-only entries
  assigned by Aurboda (`garmin-links.json`).
