# Meals & Nutrition

Track food intake with meal flag/allergen logging, imported nutrition data from Cronometer and Oura, and per-item micronutrient tracking.

## Quick Logging (Web UI)

The `/meals` page provides a day-by-day view with configurable meal slots (Breakfast, Lunch, Snack, Dinner). Each slot has:

- **Time preset buttons** -- quickly set the meal time to your default hour +/- 1
- **Meal Flag checkboxes** -- check which meal flags apply (e.g., gluten, dairy, red meat)
- **Food item chips** -- click any food item to map it to meal flags (saved globally)
- **"Logging complete" checkbox** -- mark a day as fully logged for data reliability

### Configuration (Settings page)

- **Meal Flags** -- define the areas you want to track (e.g., "gluten", "dairy", "red_meat", "legumes")
- **Meal Slots** -- define slot names and default hours (e.g., Breakfast at 7, Lunch at 12)
- **Food-to-Meal Flag Map** -- automatically built as you click food items and assign meal flags

### Meal Detail Page

Click a meal name or the "..." button on a slot row to open `/meals/:id`, where you can edit:

- Name/description
- Exact time (datetime picker)
- Notes

## Data Model

Each meal has:

- `id` (UUID, client-generated for idempotent PUT)
- `time`, `meal_type`, `name`, `source`
- Macros: `calories`, `protein`, `carbs`, `fat`, `fiber`
- `food_items[]` -- individual food items, each with name, quantity, unit, macros, and micronutrients. A logged item may also carry `food_item_portion_id` + `portion_count` when logged via a portion (see [Food Items & Portions](#food-items--portions)).
- `micros` -- meal-level micronutrients (aggregated from food items)
- `meal flags[]` -- tagged meal flags
- `notes`

### Micronutrient Format

Micronutrients use structured `{ value, unit }` objects for explicit unit tracking:

```json
{
  "b1_thiamine": { "value": 0.57, "unit": "mg" },
  "vitamin_c": { "value": 14.86, "unit": "mg" },
  "iron": { "value": 3.1, "unit": "mg" },
  "vitamin_d": { "value": 80.0, "unit": "iu" }
}
```

Legacy data (from Oura) uses plain numbers: `{ "iron": 3.2 }`.

## Food Items & Portions

Meals reference a **canonical food item** by `food_item_id` rather than embedding nutrition inline. The food item carries the nutrient values; the meal junction (`meal_food_items`) snapshots scaled values at log time so historical meals stay frozen even when the food item is later edited.

A food item may be:

- **Atomic** -- its own nutrient columns are authoritative.
- **Composite (recipe)** -- nutrients are derived at read time by summing its ingredients (`food_item_ingredients`), each scaled by `quantity / default_quantity`.
- **Reference-enriched** -- an atomic item with `reference_food_item_id` pointing at a richer canonical item (e.g. a Livsmedelsverket row) to inherit empty micronutrient fields, scaled by serving.

Food items live in the per-user `food_items` table or the central, read-only `shared_food_items` library (see [Livsmedelsverket docs](../livsmedelsverket.md)). `food_item_id` is a soft pointer across both stores.

### Base unit

Every food item has a **base unit** -- its `default_quantity` + `default_unit` (e.g. `100 g`, `2 wrap`). This is the amount the nutrient columns are measured _per_. All foods have at least this one unit (a backfill ensures it: per-user foods missing one default to `1 portion`, central shared foods to `100 g`).

### Additional units (portions)

A food item can define extra **units** in the `food_item_portions` table -- alternative units the user can pick when logging. Each is a named unit plus its conversion to the base unit:

> `1` `label_unit` = `base_equivalent` base units

`label_unit` is shown bare -- it never contains a number. The number lives in the quantity the user enters when logging.

Examples (per food):

| Food           | Base unit | Units (`1 label_unit` → `base_equivalent` base units) |
| -------------- | --------- | ----------------------------------------------------- |
| Fylld tortilla | `2 wrap`  | `1 wrap` → `1` (enter `1 wrap` ⇒ ×0.5)                |
| Lantmjölk      | `100 g`   | `1 glas` → `515`                                      |
| Choklad        | `100 g`   | `1 ruta` → `3.4`; `1 rad` → `13.6`                    |

When logging, the user enters a **quantity in the chosen unit**. To scale a nutrient for quantity `Q` of a unit:

```
nutrient_value × Q × base_equivalent / default_quantity
```

So `3 ruta` of a 100 g chocolate base at 500 kcal/100 g = `500 × 3 × 3.4 / 100` = 51 kcal. The base unit itself is just the unit with `base_equivalent = 1` (entering `58 g` on a 100 g base ⇒ ×0.58; entering `1 wrap` on a `2 wrap` base ⇒ ×0.5).

Conversions are **direct-to-base only** -- a unit never references another unit (no chaining).

`food_item_portions.food_item_id` is a soft pointer, so units can target a per-user food OR a central shared food. Deleting a per-user food cascades its units (app-level); deleting a unit clears any `default_portion_id` that pointed at it.

### Default logging amount

A food's preselected logging amount is a **unit + quantity** pair, resolved on the food-item detail response as `effective_default_portion_id` (the unit) and `effective_default_quantity` (the amount):

- **Per-user food** -- `food_items.default_portion_id` + `food_items.default_log_quantity`. A NULL unit means the base unit; a NULL quantity falls back to `default_quantity` (the base quantity).
- **Central shared food** -- the user's `shared_food_item_overrides.default_portion_id` + `default_log_quantity` (NULL ⇒ fall through to the central row's own default / base). This lets a user pin e.g. "2 dl" as their default on a read-only LSV milk row without forking it.

The default amount can differ from the base sizing -- e.g. a base of `1 wrap` but a default of `2 wrap`.

### Logging with a unit

When a meal item is logged with `food_item_portion_id` + `portion_count` (the entered quantity in that unit):

- Nutrients are snapshotted using the formula above.
- The junction's legacy `quantity` / `unit` are populated from the entered count + the unit's `label_unit` so a meal still renders "3 ruta" even if the unit is later deleted.
- Re-snapshotting (`resnapshot_meals_for_food_item`) refetches the unit and rescales; if it was deleted since logging, the frozen snapshot is preserved rather than recomputed against a mismatched unit.

Logging on the base unit uses the legacy free-form `quantity` + `unit` path, unchanged.

### Food-item REST endpoints

- `GET /food-items?q=&limit=` -- search the merged (user + central) library
- `GET /food-items/:id` -- detail; includes `portions[]`, `effective_default_portion_id`, composite ingredients/derived nutrients, reference enrichment, sensitivities
- `POST /food-items` -- create a per-user food item
- `PATCH /food-items/:id` -- update a per-user food item (does **not** accept `default_portion_id` -- use the dedicated endpoint below)
- `DELETE /food-items/:id` -- delete a per-user food item
- `POST /food-items/:id/duplicate` -- duplicate into a fresh per-user copy named `"<name> (copy)"` (deduped); copies nutrients, defaults, composite ingredients, portions, reference, and sensitivities. Works on per-user **and** central items (a central copy becomes an editable per-user fork). Returns the new copy's detail.
- `GET /food-items/:id/portions` -- list portions
- `POST /food-items/:id/portions` -- add a portion
- `PATCH /food-items/:id/portions/:portionId` -- update a portion (404 if it doesn't belong to `:id`)
- `DELETE /food-items/:id/portions/:portionId` -- delete a portion (404 if it doesn't belong to `:id`)
- `PUT /food-items/:id/default-portion` -- set/clear the default logging amount; body `{ "portion_id": "<uuid>" | null, "quantity": <number> | null }` (`portion_id` null = base unit, `quantity` null = base quantity)
- `PUT /food-items/:id/override` -- per-user override on a central item; accepts `icon`, `default_portion_id`, and/or `default_log_quantity`
- Composite/reference helpers: `PUT|DELETE /food-items/:id/ingredients`, `PUT|DELETE /food-items/:id/reference`, `POST /food-items/:id/resnapshot-meals`, merge endpoints

## Data Sources

### Manual (Web UI)

Quick-log via meal flag checkboxes. Creates meals with `source: "manual"`.

### Oura

Meals synced from the Oura app. Includes meal name, food items (names only, no nutrition data), and meal type. See [Oura docs](../oura.md).

### Cronometer

Import from CSV export using the import script:

```bash
cd apps/backend && npx tsx ../../scripts/cronometer/import.ts <servings.csv> [dailysummary.csv]
```

Imports:

- Food items with full per-item macros and ~50 micronutrients (all with explicit units)
- Meal-level aggregated totals
- Daily `log_completed` flags from the daily summary
- Default meal times from meal type (Breakfast=7, Lunch=12, Dinner=18, Snacks=15)

The script uses `PUT /meals` (idempotent) so re-running is safe.

Auth is read from `~/.config/aurboda/config`.

## API

- `PUT /meals` -- upsert a meal (client-generated UUID, idempotent)
- `POST /meals` -- create a meal (server-generated UUID, backwards-compatible)
- `GET /meals?start=&end=&date=` -- query meals with optional log_completed
- `GET /meals/:id` -- get a single meal
- `PATCH /meals/:id` -- update meal fields
- `DELETE /meals/:id` -- delete a meal
- `PUT /meals/log-completed/:date` -- mark day as logging-complete
- `DELETE /meals/log-completed/:date` -- unmark
- `GET /meals/period-summary?start=&end=&tz=&count_only_completed=` -- daily-averaged nutrient intake + averaged calories_total burn. When `count_only_completed=true`, only days marked as log-completed contribute to averages; the response always reports `days_completed` so the UI can show "avg from N completed".
- `GET /nutrient-recommendations` -- effective merged list (NNR2023 + user overrides)
- `PUT /nutrient-recommendations/:nutrient_name` -- upsert a user override (pass null on a bound to suppress the central default)
- `DELETE /nutrient-recommendations/:nutrient_name` -- revert to central default

## MCP Tools

Meals:

- `add_meal` -- create/upsert a meal. `food_items[*]` accept either the legacy `quantity` + `unit` or `food_item_portion_id` + `portion_count` (portion path)
- `query_meals` -- query by date range and meal type
- `get_meal` -- get by ID
- `update_meal` -- update fields
- `delete_meal` -- delete by ID
- `query_meals_period_summary` -- daily-averaged nutrient intake + calories burned over a date range

Food items & portions:

- `search_food_items` / `get_food_item` -- search / fetch the merged library (detail includes `portions[]` + `effective_default_portion_id`)
- `add_food_item` / `update_food_item` / `delete_food_item` -- per-user food item CRUD
- `duplicate_food_item` -- copy a food item (per-user or central) into a fresh editable per-user `"<name> (copy)"`, including ingredients, portions, reference, and sensitivities
- `list_food_item_portions` -- list a food's portions
- `add_food_item_portion` / `update_food_item_portion` / `delete_food_item_portion` -- portion CRUD (per-user OR central food, soft pointer)
- `set_default_food_item_portion` -- set/clear a per-user food's default logging amount (`portion_id` + `quantity`; `portion_id: null` = base unit, `quantity: null` = base quantity)
- `set_shared_food_item_override` / `clear_shared_food_item_override` -- per-user overrides on a central item (`icon`, `default_portion_id`, `default_log_quantity`)
- `set_food_item_ingredients` / `clear_food_item_ingredients` -- composite recipes; `set_food_item_reference` -- reference enrichment; `resnapshot_meals_for_food_item` -- refresh historical meal snapshots; `merge_food_items` / `preview_food_item_merge`

Nutrient recommendations:

- `get_nutrient_recommendations` -- effective merged list
- `set_nutrient_recommendation` -- upsert a user override
- `clear_nutrient_recommendation` -- revert to central default

## Multi-day Overview

The Meals page exposes a second tab, **Overview**, with averaged nutrient intake over a selectable window (7 / 14 / 30 / 90 days) plus an energy-balance row comparing average kcal eaten against averaged daily `calories_total` burned.

Each nutrient is rendered against a recommended min/max range using the same `ReferenceRangeBar` component reports use. The defaults come from a curated **NNR2023** seed in the central database; per-user overrides live in the `user_nutrient_recommendations` table and win whenever present. A user override can also explicitly suppress a nutrient's range (NULL/NULL) so the value is shown without a bar.

Averaging ignores days with no meal data — a sparse log is not dragged toward zero. `calories_burned` is `null` when no `calories_total` metric exists in the window (the UI prompts to connect Garmin / Health Connect in that case).
