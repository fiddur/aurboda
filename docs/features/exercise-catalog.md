# Exercise catalogue

Aurboda ships a built-in, versioned catalogue of strength exercises: names, aliases, the equipment
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

## Entries

| Field       | Meaning                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `key`       | Stable identifier, `[a-z][a-z0-9_]*`. Once released a key is never renamed and never reused                             |
| `name`      | Display name                                                                                                            |
| `aliases`   | Other names that identify exactly this exercise                                                                         |
| `category`  | `strength`, `stretching` or `plyometrics`                                                                               |
| `equipment` | `[{ key, name, category }]`, the equipment category one of `free_weights`, `machines`, `cables`, `other`                |
| `muscles`   | `[{ key, name, group, weight }]`, by weight (highest first), then key                                                   |
| `same_as`   | The same exercise elsewhere: `bodybuild` (its id), `free_exercise_db` (its id), `wikidata` (a Q id), `fit` (unused yet) |

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
  entries that come from body.build (hand-picked gym exercises) go first, then names starting with
  `q`; ties go to the shorter name.
- `name` -- an exact name-or-alias match after normalisation: zero or one entry. `q` is ignored.
- `equipment`, `category` -- exact keys. `muscle` -- a muscle or a group key: exercises working that
  muscle, or a muscle of that group, at weight 0.5 or more.
- `limit` (1--100, default 20), `offset` (default 0). Without `q` the order is by name.

An unknown `equipment`, `muscle` or `category` is a 400.

## Sources

| Source                                                          | Commit                                     | License   |
| --------------------------------------------------------------- | ------------------------------------------ | --------- |
| [body.build](https://github.com/Dieterbe/body.build)            | `4d8bbcc5ccea4d6802ee373a0be1aa5f5dcc8dd6` | AGPL-3.0  |
| [free-exercise-db](https://github.com/yuhonas/free-exercise-db) | `f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5` | Unlicense |

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
id. `apps/backend/src/catalog/exercises/NOTICE.md` has the attribution and what was changed.

## Files and rebuilding

Everything lives in `apps/backend/src/catalog/exercises/`:

| File                            | What                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `exercise-catalog.json`         | The built catalogue the backend serves. Generated: never edit it by hand     |
| `links.json`                    | Hand-curated: `version`, links, name overrides, aliases, equipment, Wikidata |
| `sources/bodybuild.json`        | Converted from body.build's Dart files                                       |
| `sources/free-exercise-db.json` | Trimmed copy of free-exercise-db                                             |
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
```

To add or correct an entry: edit `links.json` (or a source file), rebuild, and bump `version` in
`links.json`. The tests check that the committed catalogue is exactly what the committed sources and
links build.

**Keys never change.** The build derives each key from its entry's name, and a key is an API
contract once released: never rename one and never reuse the key of a removed entry. Since a new name
gives a new key, a rename that would change a released key (a name override, or a name changed
upstream) must not land as is: keep the name and add the new spelling to `aliases` in `links.json`.
