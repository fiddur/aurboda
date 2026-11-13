# Exercise catalogue: sources and attribution

`exercise-catalog.json` is built from two open datasets by the scripts in `build/`. See
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
