# Livsmedelsverket (Swedish Food Agency)

Bulk import of the [Swedish Food Composition Database](https://www.livsmedelsverket.se/en/about-us/open-data/food-composition-data/) into the canonical `food_items` library. Provides per-100 g macros + micronutrient data for ~2,575 Swedish foods, used to enrich meal logs and as reference data for branded products.

## What's synced

For each LSV food item we upsert a row into `food_items` with:

- `name` — the Swedish food name (`namn`)
- `source` — `livsmedelsverket`
- `default_quantity` / `default_unit` — `100` / `g` (LSV reports nutrients per 100 g edible portion)
- All mappable nutrients: macros (calories, protein, carbs, fat, fiber, water, alcohol, ash, salt, sugars), fat breakdown (saturated, mono, poly, ALA, LA, DHA, DPA, EPA, AA, cholesterol), vitamins A/C/D/E/K/B1/B2/B3/B5/B6/B12/folate/retinol/beta-carotene, and minerals Ca/Cu/Fe/Mg/Mn/P/K/Se/Na/Zn/I.

Codes our schema doesn't currently track (e.g. niacin equivalents, sucrose, monosaccharides) are skipped silently. Amino acids are not in the standard LSV dataset. The mapping table lives in `apps/backend/src/services/imports/livsmedelsverket.ts` (`EUROFIR_TO_COLUMN`).

`ENERC` appears twice per food (once in kJ, once in kcal); we take the kcal row.

## Admin setup

Nothing — the LSV API is unauthenticated and does not require API keys.

## User setup

Navigate to `/food-items` and click **Import from Livsmedelsverket**. The job runs in the background and the panel polls progress every 2 s. Imports are idempotent (upsert by name); re-running refreshes any items LSV has updated.

## How sync works

`startImport()` (in `apps/backend/src/services/imports/runner.ts`) inserts a row in `import_jobs` and kicks off the work as a fire-and-forget promise:

1. Page through `GET /api/v1/livsmedel?offset=…&limit=200&sprak=1` to build the catalog (~13 calls for 2,575 items).
2. Set `total_items` and flip the job to `running`.
3. For each food, fetch `GET /api/v1/livsmedel/{nummer}/naringsvarden?sprak=1`, map nutrients, and upsert into `food_items`. Tick `processed_items` every 20 rows.
4. Mark `completed` (or `failed` with an error message). Per-item errors are logged but don't abort the run.

A small polite delay (50 ms) between per-food fetches keeps us under any unpublished rate limit.

If the backend crashes mid-import, the next time the user opens the food-items page the `GET /imports` handler reaps any `running` job older than 1 hour as `failed` so the UI doesn't stay stuck.

## Endpoints

REST:

- `POST /api/imports/livsmedelsverket` — start a new import. Returns the `ImportJob`.
- `GET /api/imports?source=livsmedelsverket&limit=10` — list recent jobs (newest first).
- `GET /api/imports/:id` — single job (used by the UI for polling).

MCP:

- `start_livsmedelsverket_import`
- `list_import_jobs`
- `get_import_job`

## Attribution and license

Data is published by [Livsmedelsverket / Swedish Food Agency](https://www.livsmedelsverket.se/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The food-items page renders the attribution alongside the import button.
