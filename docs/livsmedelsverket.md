# Livsmedelsverket (Swedish Food Agency)

Bulk import of the [Swedish Food Composition Database](https://www.livsmedelsverket.se/en/about-us/open-data/food-composition-data/) into the **shared** food library. Provides per-100 g macros + micronutrient data for ~2,575 Swedish foods, available to every user as canonical reference data — used to enrich meal logs, as the basis for branded products (Phase 6 reference enrichment), and likely for future barcode-scanning integrations.

## Where the data lives

The shared library is a single table — `shared_food_items` — in the **central database** (`aurboda`). Every user sees the same rows; per-user `food_items` tables continue to hold each user's own custom items. Search and read paths in the backend merge both stores so the API surface stays unchanged for clients.

A meal item that points at a shared row stores `food_item_id` as a soft pointer (no FK, since the row lives in a different database). Display name, icon, and nutrient values are snapshotted onto `meal_food_items` at insertion time — meal reads never have to JOIN across databases.

### Per-user overrides

The shared library is read-only from a user's perspective — one canonical LSV row serves every user. To let users customize a shared row without forking it (e.g. their own icon for a generic "Banan" entry), per-user customizations live in `shared_food_item_overrides` (per-user DB), keyed by `shared_food_item_id` as a soft pointer to central. Override columns are layered onto the central row at read time in the food-items service. The table grows via idempotent `ALTER TABLE ADD COLUMN IF NOT EXISTS`; today it holds:

- `icon` — `string` sets the icon, `null` hides the central icon, missing row falls through. Because `null` is a meaningful "hide" value, a companion `icon_overridden` boolean distinguishes "user explicitly chose an icon value (including null)" from "column left at its default because only another field was set" — without it, setting only `default_portion_id` would leave `icon` at the column-default `NULL` and silently hide the central icon.
- `default_portion_id` — the user's preselected portion for this central food (see [Meals & Nutrition → Food Items & Portions](features/meals.md#food-items--portions)). `null`/missing falls through to the central row's own default (currently always the base portion). Surfaced as `effective_default_portion_id` on the food-item detail response.

REST endpoints (per shared item id): `GET /api/food-items/:id/override`, `PUT /api/food-items/:id/override`, `DELETE /api/food-items/:id/override`. MCP equivalents: `set_shared_food_item_override`, `clear_shared_food_item_override`. All reject ids that resolve to a per-user item — those are editable directly via the standard food-item routes.

## What's synced

For each LSV food item we upsert a row into `shared_food_items` with:

- `name` — the Swedish food name (`namn`)
- `source` — `livsmedelsverket`
- `source_id` — the LSV `nummer` (stable identifier; re-imports key off this so renames don't orphan rows)
- `default_quantity` / `default_unit` — `100` / `g` (LSV reports nutrients per 100 g edible portion)
- All mappable nutrients: macros (calories, protein, carbs, fat, fiber, water, alcohol, ash, salt, sugars), fat breakdown (saturated, mono, poly, ALA, LA, DHA, DPA, EPA, AA, cholesterol), vitamins A/C/D/E/K/B1/B2/B3/B5/B6/B12/folate/retinol/beta-carotene, and minerals Ca/Cu/Fe/Mg/Mn/P/K/Se/Na/Zn/I.

Codes our schema doesn't currently track (e.g. niacin equivalents, sucrose, monosaccharides) are skipped silently. Amino acids are not in the standard LSV dataset. The mapping table lives in `apps/backend/src/services/imports/livsmedelsverket.ts` (`EUROFIR_TO_COLUMN`).

`ENERC` appears twice per food (once in kJ, once in kcal); we take the kcal row. Mass-to-mass unit conversions defend against an LSV unit-convention drift but are logged loudly when they fire — silently producing wrong-magnitude values is the worst failure mode.

## Admin setup

Nothing — the LSV API is unauthenticated and does not require API keys.

## Triggering an import

The import is a server-wide admin action: only users with the `admin` role can start one, and there's only ever one import per source running at a time (single-flight guard in `startImport`). Once it's run, the data is available to **all** users.

In the web UI: navigate to **Admin Settings** → **Shared Food Library** → click _Import from Livsmedelsverket_. The panel polls every 2 s and shows progress + skipped count.

## How sync works

`startImport()` (in `apps/backend/src/services/imports/runner.ts`) inserts a row in the central `import_jobs` table and kicks off the work as a fire-and-forget promise:

1. Page through `GET /api/v1/livsmedel?offset=…&limit=200&sprak=1` to build the catalog (~13 calls for 2,575 items).
2. Set `total_items` and flip the job to `running`.
3. For each food, fetch `GET /api/v1/livsmedel/{nummer}/naringsvarden?sprak=1`, map nutrients, and upsert into `shared_food_items`. Tick `processed_items` (and `skipped_items` for fetch failures) every 20 rows; touch `last_progress_at` for the heartbeat reaper.
4. Mark `completed` (or `failed` with an error message). Per-item errors are logged but don't abort the run.

A small polite delay (50 ms) between per-food fetches keeps us under any unpublished rate limit.

If the backend crashes or stalls mid-import, the heartbeat-based reaper marks any job whose `last_progress_at` hasn't advanced in 10 minutes as `failed` so the UI doesn't stay stuck. The reaper runs on the admin import-list poll, throttled to once per 60 s.

## Endpoints

All admin-only.

REST:

- `POST /api/admin/imports/livsmedelsverket` — start a new import. Returns the `ImportJob`. Single-flight: returns the existing pending/running job if one already exists.
- `GET /api/admin/imports?source=livsmedelsverket&limit=10` — list recent jobs (newest first).
- `GET /api/admin/imports/:id` — single job (used by the UI for polling).

MCP:

- `start_livsmedelsverket_import` _(admin-only)_
- `list_import_jobs` _(admin-only)_
- `get_import_job` _(admin-only)_

## Attribution and license

Data is published by [Livsmedelsverket / Swedish Food Agency](https://www.livsmedelsverket.se/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The Admin Settings page renders the attribution alongside the import button.

## Other sources (future)

The shared library is source-agnostic — `shared_food_items` rows carry a `source` (free-form string) and a `source_id` (the upstream identifier). Adding another reference DB only needs:

- A service module that fetches the catalog + per-item data and calls `centralDb.upsertSharedFoodItem({ source: <source>, source_id, ... })`.
- A new `runners[<source>]` entry in `services/imports/runner.ts`.
- A new `POST /admin/imports/<source>` route.

Concrete candidates a Swedish/Nordic install might want next:

- **[OpenFoodFacts](https://world.openfoodfacts.org/)** — community-edited global database of branded products with EAN/UPC barcodes, ingredients, NutriScore, allergens. ODbL-licensed (attribution required). The natural fit for barcode-scanning, since the canonical key is the barcode itself (use it as `source_id`). On-demand fetch by barcode is cheaper than bulk-importing 3M+ products.
- **[USDA FoodData Central](https://fdc.nal.usda.gov/)** — US equivalent of LSV, public-domain, well-structured nutrient data.
- Other national agencies (e.g. UK CoFID, Finnish Fineli) for installs in those countries.
