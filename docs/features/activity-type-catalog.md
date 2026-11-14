# Activity type catalogue

Aurboda ships a built-in, versioned catalogue of activity types for the things a watch or ring
does not record and you log by hand: a coffee, a painkiller, a headache, a sauna. Each entry has a
name, display name, [display category](activity-types.md#display-categories), colour, icon,
aliases and the fields of its `data` (its [data schema](activity-types.md#data-schema-and-categorical-fields)).
The catalogue is data in the repository (`apps/backend/src/catalog/activity-types/`), the same on
every server, and read only.

A catalogue type is not one of your types until you use it. The first time you do, it is added to
your types with its fields, and from then on it is an ordinary custom type: you can edit, rename,
merge or delete it like any type you made yourself. The link between your type and the catalogue
is the type's **name**; nothing else is stored.

## The types

| Type               | Display name        | Group    | Fields                                                                                                                             |
| ------------------ | ------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `alcohol`          | 🍷 Alcohol          | intake   | kind (beer, wine, cider, spirits, cocktail, other); drinks (number ≥ 0)                                                            |
| `caffeine`         | ☕ Caffeine         | intake   | kind (coffee, tea, energy_drink, other); amount (number, mg ≥ 0)                                                                   |
| `nicotine`         | 🚬 Nicotine         | intake   | kind (cigarette, snus, vape, gum_or_patch, other); amount (number ≥ 0)                                                             |
| `medication`       | 💊 Medication       | intake   | substance (string); dose (number ≥ 0); dose_unit (string)                                                                          |
| `supplement`       | 🧴 Supplement       | intake   | substance (string); dose (number ≥ 0); dose_unit (string)                                                                          |
| `late_meal`        | 🌙 Late meal        | meals    | —                                                                                                                                  |
| `heavy_meal`       | 🍽️ Heavy meal       | meals    | —                                                                                                                                  |
| `fasting`          | ⏳ Fasting          | meals    | kind (intermittent, extended)                                                                                                      |
| `diet`             | 🥗 Diet             | meals    | kind (keto, low_carb, vegetarian, vegan, calorie_deficit, other)                                                                   |
| `illness`          | 🤒 Illness          | health   | kind (cold, flu, stomach_bug, covid, other); severity (number 0–10)                                                                |
| `symptom`          | 🩺 Symptom          | health   | severity (number 0–10); the parent of the symptoms below                                                                           |
| `pain`             | ⚡ Pain             | health   | location (head, neck, shoulder, back, lower_back, chest, abdomen, pelvis, breast, hip, knee, joint, other); severity (number 0–10) |
| `injury`           | 🩹 Injury           | health   | body_part (string); kind (strain, sprain, fracture, wound, other); severity (number 0–10)                                          |
| `menstruation`     | 🩸 Menstruation     | health   | flow (light, medium, heavy)                                                                                                        |
| `sexual_activity`  | ❤️ Sexual activity  | health   | protection_used (boolean)                                                                                                          |
| `sauna`            | 🧖 Sauna            | recovery | temperature (number, °C); rounds (number ≥ 0)                                                                                      |
| `cold_exposure`    | 🧊 Cold exposure    | recovery | kind (cold_plunge, cold_shower, ice_bath, winter_swim); temperature (number, °C)                                                   |
| `hot_bath`         | 🛁 Hot bath         | recovery | temperature (number, °C)                                                                                                           |
| `massage`          | 💆 Massage          | recovery | kind (manual, massage_gun, foam_roller)                                                                                            |
| `meditation`       | 🧘 Meditation       | recovery | technique (string); guided (boolean); session_name (string)                                                                        |
| `guided_breathing` | 🌬️ Breathwork       | recovery | technique (string); rounds (number ≥ 0)                                                                                            |
| `sun_exposure`     | ☀️ Sun exposure     | recovery | —                                                                                                                                  |
| `travel`           | 🧳 Travel           | context  | mode (plane, car, train, bus, boat)                                                                                                |
| `social_gathering` | 🎉 Social gathering | context  | —                                                                                                                                  |

Aliases: `medicine` for `medication`, `supplements` for `supplement`, `sick` and `sickness` for
`illness`, `sex` for `sexual_activity`, `breathwork` for `guided_breathing`. An alias is only
another name of the type itself.

`meditation` and `guided_breathing` are also seeded built-in types (`guided_breathing` is a
Health Connect exercise type, a child of `exercise`). They get the catalogue's fields like
`strength_training` gets its sets: filled in when the type has no schema, and `guided_breathing`
is renamed "Breathwork" where it still carries the seeded name "Guided Breathing". Nothing
else about them changes.

### Symptoms

37 sub-types of `symptom`, each with one field, `severity` (number 0–10). Their names follow
Apple HealthKit's symptom types:

- **Abdominal and gastrointestinal**: abdominal cramps, bloating, constipation, diarrhea, heartburn,
  nausea, vomiting
- **Constitutional**: appetite changes, chills, dizziness, fainting, fatigue, fever, generalized
  body ache, hot flashes
- **Heart and lung**: chest tightness or pain, coughing, rapid, pounding or fluttering heartbeat,
  shortness of breath, skipped heartbeat, wheezing
- **Neurological**: headache, memory lapse, mood changes, migraine
- **Nose and throat**: loss of smell, loss of taste, runny nose, sore throat, sinus congestion
- **Reproduction**: vaginal dryness
- **Skin and hair**: acne, dry skin, hair loss
- **Sleep**: night sweats, sleep changes
- **Urinary**: bladder incontinence

Two departures from Apple's list: `migraine` is a symptom of its own (Apple has none), and Apple's
lower back, pelvic and breast pain are one type, `pain`, with a `location`.

### Severity

Severity is a number from 0 to 10, enforced on write through the field's `min` and `max` (see
[Data Schema and Categorical Fields](activity-types.md#data-schema-and-categorical-fields)). As a
guide: 1 to 3 is mild, 4 to 6 moderate, 7 to 10 severe.

## Adoption on first use

A catalogue type becomes one of your types the first time it is used, through any of these:

- **Adding an activity** of it (`POST /activities`, `add_activity`), or changing an activity's type
  to it (`PATCH /activities/:id`, `update_activity`). The activity's `data` is then validated
  against the adopted fields, so a headache of severity 11 is refused.
- **Adding the type** with only its name (`POST /activity-types` with `{ "name": "sauna" }`,
  `add_activity_type`). Every field you leave out is taken from the catalogue; a field you give is
  used as given, and your aliases are joined with the catalogue's.
- **A deduction rule** that outputs it, when the rule is created or updated. Previewing a rule
  accepts a catalogue type without adding it.
- **An Oura tag** whose name matches a catalogue type's name, display name or alias, ignoring case
  and punctuation ("Sauna", "Cold Exposure", "Breathwork"). Other imports, such as Strava's
  exercises, are never redirected to the catalogue.

A sub-type brings its catalogue parent along: the first headache adds `symptom` too, unless you
already have a `symptom` type, in which case the headache goes under yours.

**Existing types win.** If you already have a type with a catalogue name, it is used as it is and
nothing about it changes. A tag matching a type of yours (by name or alias) lands on that type
before the catalogue is looked at.

Adopted types are custom types (`is_builtin` false). Two first uses at the same moment add the
type once.

## In the web app

- **Types** page, **+ Add Type**: while you type a display name, built-in types that match it (by
  name, display name or alias) are listed under "Built-in types that match", each with its icon,
  category and fields, and an **Add built-in** button that adds it with everything filled in. The
  ordinary **Add** still adds a custom type with the name and category you typed.
- **Types** page, **Built-in types**: below your own types, every catalogue type not in use yet,
  in the catalogue's groups (Symptoms starts collapsed), each with its fields and an **Add**
  button. The page's search box filters this list too.
- **+ Add**: the activity type picker lists the built-in types not in use yet after your own,
  marked `built-in`. Picking one shows its fields right away, and saving the activity adds the
  type. Number fields keep to their `min` and `max`, and choices read as words (`energy drink`).
- A name typed into the picker that is neither yours nor built-in is offered as **Create "..."**;
  the type is created (category Other) when the activity is saved.

## Outside vocabularies

Each entry records under `same_as` the names the same thing has elsewhere: `apple_healthkit`
(HealthKit type identifiers), `health_connect` (record types), `oura` (tag names) and `garmin`
(Lifestyle Logging behaviours). They are reference data for imports; nothing reads them yet.

## API and MCP

- `GET /activity-type-catalog?q=` -- The catalogue's version, its groups and its entries in file
  order, each with `in_use` (whether you already have a type of that name; a type in use is yours
  and may differ from the catalogue). `q` keeps the entries where every word is the start of a
  word of the name, display name or an alias.
- MCP `list_activity_type_catalog` (`q`) -- the same.

Adoption itself has no endpoint or tool of its own; it happens through the writes above.

## Versioning

The catalogue has a `version` (`2026.11.1`). A new version only affects types adopted after it: a
type you already have is yours, and a later catalogue change never rewrites it.

## Not there yet

- Offering the catalogue's fields to a type you already have, and merging a type into another
  while setting a field (beer as `alcohol` with kind `beer`): #1701.
- Matching Oura's own tag codes rather than tag names: #1702.
- Importing Health Connect records into catalogue types: #1703.
- The catalogue in the Android Add tab: #1704.

See [`NOTICE.md`](../../apps/backend/src/catalog/activity-types/NOTICE.md) for where the names
come from.
