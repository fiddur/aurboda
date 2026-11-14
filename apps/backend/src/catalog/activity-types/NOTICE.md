# Activity type catalogue: sources

`activity-type-catalog.json` is written by hand. See
[docs/features/activity-type-catalog.md](../../../../../docs/features/activity-type-catalog.md).

The list of types is Aurboda's own. The symptom names follow Apple HealthKit's symptom type
identifiers (`HKCategoryTypeIdentifier…`). The other names were compared with Health Connect's
record types, Oura's tags and Garmin's Lifestyle Logging behaviours, and each entry records the
matching names under `same_as`.

No dataset was copied: the names of things are facts, and the fields, groups, colours and icons are
Aurboda's.

Two departures from Apple's list: `migraine` is a symptom of its own, and Apple's three located
pains (lower back, pelvic and breast pain) are one type, `pain`, with a `location`.
