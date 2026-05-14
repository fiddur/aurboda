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
- `food_items[]` -- individual food items, each with name, quantity, unit, macros, and micronutrients
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

- `add_meal` -- create/upsert a meal
- `query_meals` -- query by date range and meal type
- `get_meal` -- get by ID
- `update_meal` -- update fields
- `delete_meal` -- delete by ID
- `query_meals_period_summary` -- daily-averaged nutrient intake + calories burned over a date range
- `get_nutrient_recommendations` -- effective merged list
- `set_nutrient_recommendation` -- upsert a user override
- `clear_nutrient_recommendation` -- revert to central default

## Multi-day Overview

The Meals page exposes a second tab, **Overview**, with averaged nutrient intake over a selectable window (7 / 14 / 30 / 90 days) plus an energy-balance row comparing average kcal eaten against averaged daily `calories_total` burned.

Each nutrient is rendered against a recommended min/max range using the same `ReferenceRangeBar` component reports use. The defaults come from a curated **NNR2023** seed in the central database; per-user overrides live in the `user_nutrient_recommendations` table and win whenever present. A user override can also explicitly suppress a nutrient's range (NULL/NULL) so the value is shown without a bar.

Averaging ignores days with no meal data — a sparse log is not dragged toward zero. `calories_burned` is `null` when no `calories_total` metric exists in the window (the UI prompts to connect Garmin / Health Connect in that case).
