# Exercise catalogue

Aurboda ships a built-in, versioned catalogue of strength, stretching and plyometric exercises: names, aliases, the equipment
each uses and the muscles it works. It is data in the repository, the same on every server, and read
only. Each exercise has a stable **key** such as `dumbbell_bench_press`.

Logged exercise names stay free text on the sets; each name resolves to a catalogue key on read,
automatically or by the user's own mapping. See
[Exercise identities](./activity-types.md#exercise-identities).

## In the web app

A data-schema item field with `"catalog": "exercises"` is matched against this catalogue; the
built-in `strength_training` schema sets it on `sets.exercise` (see
[Activity types](activity-types.md#data-schema-and-categorical-fields)).

- **Set editor**: typing an exercise suggests the names already logged for the type first, then
  catalogue exercises (`GET /exercise-catalog?q=…`, from two characters), each with its main muscles.
  Picking one writes its name; any other text is kept as typed.
- **Exercise page**: a section shows the name's [identity](activity-types.md#exercise-identities)
  (`GET /activity-types/:name/item-values/identity`). Matched by name or mapped by you, it lists the
  entry's primary muscles (weight 0.75 or more), secondary muscles and equipment, and the catalogue
  name when it is spelled differently; "Change" opens a catalogue search to map the name to another
  entry, and "Not this exercise" (a match by name) or "Remove mapping" (your mapping) undoes it. An
  unmatched name opens the search directly and can be marked "Not in the catalogue"; a name so
  marked has "Undo". Other logged names resolving to the same entry are listed with their counts,
  as candidates for the page's merge.
- **Type page**: under each catalogue-backed item field, "Not in the catalogue" summarises the
  logged names that match no entry and that you have neither mapped nor dismissed
  (`GET /activity-types/:name/item-values/unmapped`). "Review" lists them, most used first, 20 at a
  time, each with up to three suggested entries to map it to with one click, a catalogue search, and
  "Not in the catalogue" to dismiss it. Nothing here is required: an unmapped name keeps working
  everywhere.

The muscles of a matched entry also count its sets per muscle group, on the type page's weekly chart
and on an activity's page; see [Muscle groups](activity-types.md#muscle-groups).

## Entries

| Field       | Meaning                                                                                                                                                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`       | Stable identifier, `[a-z][a-z0-9_]*`. Once released a key is never renamed and never reused                                                                                                                                                                 |
| `name`      | Display name                                                                                                                                                                                                                                                |
| `aliases`   | Other names that identify exactly this exercise                                                                                                                                                                                                             |
| `category`  | `strength`, `stretching` or `plyometrics`                                                                                                                                                                                                                   |
| `equipment` | `[{ key, name, category }]`, the equipment category one of `free_weights`, `machines`, `cables`, `other`                                                                                                                                                    |
| `muscles`   | `[{ key, name, group, weight }]`, by weight (highest first), then key                                                                                                                                                                                       |
| `same_as`   | The same exercise elsewhere: `bodybuild` (its id), `free_exercise_db` (its id), `fit`, `wikidata` (a Q id). `fit` is the sorted list of Garmin FIT exercises (`<category>/<name>`, lower case) the entry stands for; each FIT exercise is on one entry only |

The **recruitment weight** is in (0, 1]: how much the exercise works the muscle. From body.build it is
the number of the exercise's volume assignment for that muscle, overlaid with the default option of
each of its tweaks; from free-exercise-db a primary muscle is 1 and a secondary one 0.5.

Names and aliases are unique across the catalogue after **normalisation**: lowercase, every run of
characters other than letters and digits made one space, trimmed. `Barbell Bench-Press` and
`barbell bench press` are one name.

### Vocabulary

Muscle groups: `chest`, `shoulders`, `traps`, `lats`, `middle_back`, `lower_back`, `biceps`,
`triceps`, `forearms`, `abdominals`, `glutes`, `abductors`, `adductors`, `quadriceps`, `hamstrings`,
`calves`, `neck`. Every group is also a muscle. The finer muscles, with their group:

| Group        | Muscles                                       |
| ------------ | --------------------------------------------- |
| `forearms`   | `wrist_flexors`, `wrist_extensors`            |
| `chest`      | `lower_pecs`, `upper_pecs`                    |
| `shoulders`  | `front_delts`, `side_delts`, `rear_delts`     |
| `traps`      | `lower_traps`, `middle_traps`, `upper_traps`  |
| `triceps`    | `triceps_medial_lateral`, `triceps_long_head` |
| `abdominals` | `abs`, `obliques`                             |
| `lower_back` | `spinal_erectors`                             |
| `quadriceps` | `quads_vasti`, `quads_rectus_femoris`         |
| `hamstrings` | `hamstrings_short_head`                       |
| `glutes`     | `glute_max`                                   |
| `abductors`  | `glute_med`                                   |
| `calves`     | `gastrocnemius`, `soleus`                     |

Equipment: generic keys (`barbell`, `dumbbell`, `kettlebell`, `ez_bar`, `plate`, `cable`,
`dual_cable`, `machine`, `bands`, `medicine_ball`, `exercise_ball`, `foam_roll`, `trx`,
`gymnastic_rings`, `other`) and body.build's specific machines (`smith_machine_angled`,
`lat_pulldown_machine`, `hyper_45`, `squat_rack`, …). The full lists, with display names, are
`exerciseMuscleInfo` and `exerciseEquipmentInfo` in `packages/api-spec/src/schemas/exercise-catalog.ts`.

## REST and MCP

| REST                         | MCP                          | What it does                                    |
| ---------------------------- | ---------------------------- | ----------------------------------------------- |
| `GET /exercise-catalog`      | `search_exercise_catalog`    | Search, `{ version, total, entries }`           |
| `GET /exercise-catalog/:key` | `get_exercise_catalog_entry` | One entry, `{ version, entry }`; 404 if unknown |

Search parameters:

- `q` -- words; each must be the start of a word of the name, an alias or a search term (search
  terms are extra, non-unique words such as `hamstring curl` or `DB`). Ranked: an exact name or alias
  first, then the entries whose name contains every word, then the rest. Among the name matches the
  entries that come from body.build (hand-picked gym exercises) go first, then those from
  free-exercise-db, then the Garmin-only entries, then names starting with `q`; ties go to the
  shorter name.
- `name` -- an exact name-or-alias match after normalisation: zero or one entry. `q` is ignored.
- `fit` -- an exact Garmin FIT exercise, `<category>/<name>` in any letter case (e.g.
  `bench_press/barbell_bench_press`): zero or one entry. `q` is ignored. With `name` as well, the
  entry has to match both.
- `equipment`, `category` -- exact keys. `muscle` -- a muscle or a group key: exercises working that
  muscle, or a muscle of that group, at weight 0.5 or more.
- `limit` (1--100, default 20), `offset` (default 0). Without `q` the order is by name.

An unknown `equipment`, `muscle` or `category` is a 400.

## Sources

| Source                                                                                       | Commit                                     | License     |
| -------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------- |
| [body.build](https://github.com/Dieterbe/body.build)                                         | `4d8bbcc5ccea4d6802ee373a0be1aa5f5dcc8dd6` | AGPL-3.0    |
| [free-exercise-db](https://github.com/yuhonas/free-exercise-db)                              | `f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5` | Unlicense   |
| [Garmin Connect exercise list](https://connect.garmin.com/web-data/exercises/Exercises.json) | fetched 2026-11-13                         | none stated |

From body.build: the strength exercises (the cardio block is left out), their equipment, recruitment
weights and search aliases. An exercise's weights are its volume assignment, then, for each of its
tweaks in order, the volume assignment of that tweak's default option (the second argument of
`Tweak(name, default, options)`; for a tweak function such as `hipAbductionHipFlexion('0')`, its
argument), a later entry replacing an earlier one's weight for the same program group, and zero
weights dropped. This is what body.build shows for an exercise with no tweak changed, and it is how
the pull-up, the lat pulldown and the fly variants get their muscles. Nothing else is taken from
tweaks: not the other options, their descriptions or the constraints between tweaks. A tweak that
cannot be resolved fails the conversion.
From free-exercise-db: every exercise except cardio, with its equipment, muscles and category. The
two are merged where `links.json` links a body.build exercise to a free-exercise-db one: the entry
takes body.build's name, muscles and equipment (free-exercise-db's when body.build has none), and
free-exercise-db's category; the free-exercise-db name becomes an alias. Five entries carry a Wikidata
id.

From the Garmin Connect exercise list (`Exercises.json`, with the English display names from
`exercise_types.properties`): the names and FIT identifiers of the strength exercises only; the
running, cycling, elliptical, stair and cardio categories are left out. Every Garmin exercise is on
exactly one entry, curated in `garmin-links.json`: one that is the same exercise as a body.build or
free-exercise-db entry puts its FIT key on that entry (and its Garmin name, when it differs, becomes
an alias); a "Weighted" variant shares the entry of the unweighted exercise (the weight belongs to
the set, not to the exercise), with no alias; every other one becomes its own entry under Garmin's
display name. Garmin's muscle data is not taken: the muscles and equipment of the Garmin-only entries
are Aurboda's own, assigned by movement at muscle-group level (primary 1, secondary 0.5), and
whole-body or conditioning exercises (burpees, battle rope, sled, ladder) have none. The Garmin sync names the
sets it imports from strength activities through this FIT lookup (see
[Garmin → Strength sets](../garmin.md#strength-sets)).
`apps/backend/src/catalog/exercises/NOTICE.md` has the attribution and what was changed.

## Files and rebuilding

Everything lives in `apps/backend/src/catalog/exercises/`:

| File                            | What                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `exercise-catalog.json`         | The built catalogue the backend serves. Generated: never edit it by hand     |
| `links.json`                    | Hand-curated: `version`, links, name overrides, aliases, equipment, Wikidata |
| `garmin-links.json`             | Hand-curated: where each Garmin FIT exercise goes (see below)                |
| `sources/bodybuild.json`        | Converted from body.build's Dart files                                       |
| `sources/free-exercise-db.json` | Trimmed copy of free-exercise-db                                             |
| `sources/garmin.json`           | Garmin's FIT keys and display names, trimmed from the exercise list          |
| `build/`                        | The converter, the trimmer and the builder, with their tests                 |

Rebuild after changing `links.json` or a source file:

```sh
node apps/backend/src/catalog/exercises/build/build-catalog.ts
```

The build fails, listing the pairs, when two entries share a key or a normalised name or alias.
Resolve each in `links.json`: link the two (same movement, same equipment and stance), or give one a
name override. `name_overrides` is keyed by the key the entry would get, or by `bodybuild:<id>` or
`free_exercise_db:<id>` when two entries would get the same key; the key is derived from the
overridden name.

`equipment` in `links.json` maps a catalogue key to a list of equipment keys that replaces the
built entry's equipment, for when the source's is wrong: `[]` for none (the pull-up, whose
body.build entry names the lat pulldown machine), or the full list otherwise. The build fails on a
key no entry has, or on an equipment key outside the vocabulary.

Regenerating a source from upstream (into a directory outside the repository, then pointing the
script at it):

```sh
node apps/backend/src/catalog/exercises/build/convert-bodybuild.ts <dir with the .dart files>
node apps/backend/src/catalog/exercises/build/trim-free-exercise-db.ts <path to exercises.json>
node apps/backend/src/catalog/exercises/build/trim-garmin.ts <Exercises.json> <exercise_types.properties>
```

`garmin-links.json` places every FIT key of `sources/garmin.json` in exactly one section: `links`
(FIT key to the key of the body.build or free-exercise-db entry that is the same exercise),
`variants` (FIT key to the FIT key in `links` or `entries` whose entry it shares), or `entries` (a
Garmin-only entry: `category`, `equipment` and `muscles` assigned by Aurboda); `name_overrides`
replaces the Garmin name of an `entries` FIT key. `aliases`, `equipment` and `wikidata` in
`links.json` apply to Garmin-only entries by their key too. The build fails, naming every
offender, on a FIT key that is in no section or in two, on a key that is not in the source, on a
link to an unknown entry, a variant of a variant, or unknown vocabulary. So after refreshing
`sources/garmin.json`, the build fails until every new FIT key is curated.

To add or correct an entry: edit `links.json` (or a source file), rebuild, and bump `version` in
`links.json`. The tests check that the committed catalogue is exactly what the committed sources and
links build.

**Keys never change.** The build derives each key from its entry's name, and a key is an API
contract once released: never rename one and never reuse the key of a removed entry. Since a new name
gives a new key, a rename that would change a released key (a name override, or a name changed
upstream) must not land as is: keep the name and add the new spelling to `aliases` in `links.json`.
