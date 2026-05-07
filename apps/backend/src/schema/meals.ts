/**
 * Meal-domain table SQL: meals, meal log completion, food items, meal-food
 * junction. Food items are normalized; meal_food_items snapshots nutrient
 * values at insertion time so changes to the canonical food don't
 * retroactively alter past meals.
 */
export const mealsTables: Record<string, string> = {
  // Meal/nutrition data
  meals: `
    CREATE TABLE IF NOT EXISTS meals (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source          VARCHAR(50) NOT NULL DEFAULT 'manual',
      meal_type       VARCHAR(50),
      name            VARCHAR(255),
      time            TIMESTAMPTZ NOT NULL,
      calories        DOUBLE PRECISION,
      protein         DOUBLE PRECISION,
      carbs           DOUBLE PRECISION,
      fat             DOUBLE PRECISION,
      fiber           DOUBLE PRECISION,
      food_items      JSONB,
      micros          JSONB,
      notes           TEXT,
      sensitivities   TEXT[],
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,

  // Meal log completion flag per day
  meal_log_completed: `
    CREATE TABLE IF NOT EXISTS meal_log_completed (
      date            DATE PRIMARY KEY,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,

  // Canonical food item library (normalized from JSONB)
  food_items: `
    CREATE TABLE IF NOT EXISTS food_items (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name            VARCHAR(255) NOT NULL,
      name_lower      VARCHAR(255) NOT NULL,
      source          VARCHAR(50) NOT NULL DEFAULT 'manual',
      default_quantity DOUBLE PRECISION,
      default_unit    VARCHAR(100),
      calories        DOUBLE PRECISION,
      protein         DOUBLE PRECISION,
      carbs           DOUBLE PRECISION,
      fat             DOUBLE PRECISION,
      fiber           DOUBLE PRECISION,
      alcohol         DOUBLE PRECISION,
      caffeine        DOUBLE PRECISION,
      water           DOUBLE PRECISION,
      net_carbs       DOUBLE PRECISION,
      starch          DOUBLE PRECISION,
      sugars          DOUBLE PRECISION,
      added_sugars    DOUBLE PRECISION,
      free_sugars     DOUBLE PRECISION,
      sucrose         DOUBLE PRECISION,
      monosaccharides DOUBLE PRECISION,
      disaccharides   DOUBLE PRECISION,
      whole_grain     DOUBLE PRECISION,
      cholesterol     DOUBLE PRECISION,
      saturated_fat   DOUBLE PRECISION,
      monounsaturated_fat DOUBLE PRECISION,
      polyunsaturated_fat DOUBLE PRECISION,
      trans_fat       DOUBLE PRECISION,
      omega_3         DOUBLE PRECISION,
      omega_6         DOUBLE PRECISION,
      ala             DOUBLE PRECISION,
      dha             DOUBLE PRECISION,
      epa             DOUBLE PRECISION,
      dpa             DOUBLE PRECISION,
      aa              DOUBLE PRECISION,
      la              DOUBLE PRECISION,
      short_chain_fatty_acids DOUBLE PRECISION,
      lauric_acid     DOUBLE PRECISION,
      myristic_acid   DOUBLE PRECISION,
      palmitic_acid   DOUBLE PRECISION,
      palmitoleic_acid DOUBLE PRECISION,
      stearic_acid    DOUBLE PRECISION,
      oleic_acid      DOUBLE PRECISION,
      arachidic_acid  DOUBLE PRECISION,
      vitamin_a       DOUBLE PRECISION,
      retinol         DOUBLE PRECISION,
      beta_carotene   DOUBLE PRECISION,
      vitamin_c       DOUBLE PRECISION,
      vitamin_d       DOUBLE PRECISION,
      vitamin_d_25oh  DOUBLE PRECISION,
      vitamin_e       DOUBLE PRECISION,
      vitamin_k       DOUBLE PRECISION,
      b1_thiamine     DOUBLE PRECISION,
      b2_riboflavin   DOUBLE PRECISION,
      b3_niacin       DOUBLE PRECISION,
      niacin_equivalents DOUBLE PRECISION,
      b5_pantothenic_acid DOUBLE PRECISION,
      b6_pyridoxine   DOUBLE PRECISION,
      b12_cobalamin   DOUBLE PRECISION,
      folate          DOUBLE PRECISION,
      calcium         DOUBLE PRECISION,
      chromium        DOUBLE PRECISION,
      copper          DOUBLE PRECISION,
      iron            DOUBLE PRECISION,
      magnesium       DOUBLE PRECISION,
      manganese       DOUBLE PRECISION,
      phosphorus      DOUBLE PRECISION,
      potassium       DOUBLE PRECISION,
      selenium        DOUBLE PRECISION,
      sodium          DOUBLE PRECISION,
      zinc            DOUBLE PRECISION,
      iodine          DOUBLE PRECISION,
      cystine         DOUBLE PRECISION,
      histidine       DOUBLE PRECISION,
      isoleucine      DOUBLE PRECISION,
      leucine         DOUBLE PRECISION,
      lysine          DOUBLE PRECISION,
      methionine      DOUBLE PRECISION,
      phenylalanine   DOUBLE PRECISION,
      threonine       DOUBLE PRECISION,
      tryptophan      DOUBLE PRECISION,
      tyrosine        DOUBLE PRECISION,
      valine          DOUBLE PRECISION,
      oxalate         DOUBLE PRECISION,
      phytate         DOUBLE PRECISION,
      ash             DOUBLE PRECISION,
      salt            DOUBLE PRECISION,
      icon            TEXT,
      source_id       VARCHAR(100),
      is_composite    BOOLEAN NOT NULL DEFAULT FALSE,
      reference_food_item_id UUID,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT unique_food_item_name UNIQUE (name_lower)
    )
  `,

  food_items_indexes: `
    CREATE INDEX IF NOT EXISTS idx_food_items_name_lower ON food_items (name_lower);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_food_items_source_id
      ON food_items (source, source_id) WHERE source_id IS NOT NULL
  `,

  // Composite/recipe food items: a parent food item is "made of" several
  // ingredients, each pointing at another food (per-user OR central — the FK
  // is user-only; cross-database refs are soft pointers like meal_food_items).
  // Quantities are scaled against the ingredient's own default_quantity to
  // derive the parent's nutrient totals at read time.
  food_item_ingredients: `
    CREATE TABLE IF NOT EXISTS food_item_ingredients (
      id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      parent_food_item_id      UUID NOT NULL REFERENCES food_items(id) ON DELETE CASCADE,
      ingredient_food_item_id  UUID NOT NULL,
      quantity                 DOUBLE PRECISION NOT NULL,
      unit                     VARCHAR(100),
      sort_order               INTEGER NOT NULL DEFAULT 0,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT no_self_ingredient CHECK (parent_food_item_id <> ingredient_food_item_id)
    )
  `,
  food_item_ingredients_indexes: `
    CREATE INDEX IF NOT EXISTS idx_food_item_ingredients_parent
      ON food_item_ingredients (parent_food_item_id);
    CREATE INDEX IF NOT EXISTS idx_food_item_ingredients_ingredient
      ON food_item_ingredients (ingredient_food_item_id)
  `,

  // Fuzzy/accent-insensitive search support: pg_trgm + unaccent extensions,
  // an IMMUTABLE wrapper around unaccent so it can index, and a GIN trigram
  // index over the unaccented name. Both extensions are "trusted" in PG13+,
  // so the database owner can install them.
  food_items_search_setup: `
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE EXTENSION IF NOT EXISTS unaccent;
    CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text AS $$
      SELECT public.unaccent('public.unaccent', $1)
    $$ LANGUAGE SQL IMMUTABLE PARALLEL SAFE STRICT;
    CREATE INDEX IF NOT EXISTS idx_food_items_name_unaccent_trgm
      ON food_items USING gin (immutable_unaccent(name_lower) gin_trgm_ops)
  `,

  // Junction: meals <-> food items (snapshot of nutrients at insertion
  // time). food_item_id is a soft pointer — the row may be in the per-user
  // food_items table or in the central shared_food_items table, so there's
  // no FK. Name and icon are NOT snapshotted; they're resolved live so
  // user edits propagate to past meals. The food_item_name + food_item_icon
  // columns are kept around for legacy data and are unused by current code.
  meal_food_items: `
    CREATE TABLE IF NOT EXISTS meal_food_items (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      meal_id         UUID NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
      food_item_id    UUID NOT NULL,
      food_item_name  VARCHAR(255),
      food_item_icon  TEXT,
      quantity        DOUBLE PRECISION,
      unit            VARCHAR(100),
      sort_order      INTEGER NOT NULL DEFAULT 0,
      calories        DOUBLE PRECISION,
      protein         DOUBLE PRECISION,
      carbs           DOUBLE PRECISION,
      fat             DOUBLE PRECISION,
      fiber           DOUBLE PRECISION,
      alcohol         DOUBLE PRECISION,
      caffeine        DOUBLE PRECISION,
      water           DOUBLE PRECISION,
      net_carbs       DOUBLE PRECISION,
      starch          DOUBLE PRECISION,
      sugars          DOUBLE PRECISION,
      added_sugars    DOUBLE PRECISION,
      free_sugars     DOUBLE PRECISION,
      sucrose         DOUBLE PRECISION,
      monosaccharides DOUBLE PRECISION,
      disaccharides   DOUBLE PRECISION,
      whole_grain     DOUBLE PRECISION,
      cholesterol     DOUBLE PRECISION,
      saturated_fat   DOUBLE PRECISION,
      monounsaturated_fat DOUBLE PRECISION,
      polyunsaturated_fat DOUBLE PRECISION,
      trans_fat       DOUBLE PRECISION,
      omega_3         DOUBLE PRECISION,
      omega_6         DOUBLE PRECISION,
      ala             DOUBLE PRECISION,
      dha             DOUBLE PRECISION,
      epa             DOUBLE PRECISION,
      dpa             DOUBLE PRECISION,
      aa              DOUBLE PRECISION,
      la              DOUBLE PRECISION,
      short_chain_fatty_acids DOUBLE PRECISION,
      lauric_acid     DOUBLE PRECISION,
      myristic_acid   DOUBLE PRECISION,
      palmitic_acid   DOUBLE PRECISION,
      palmitoleic_acid DOUBLE PRECISION,
      stearic_acid    DOUBLE PRECISION,
      oleic_acid      DOUBLE PRECISION,
      arachidic_acid  DOUBLE PRECISION,
      vitamin_a       DOUBLE PRECISION,
      retinol         DOUBLE PRECISION,
      beta_carotene   DOUBLE PRECISION,
      vitamin_c       DOUBLE PRECISION,
      vitamin_d       DOUBLE PRECISION,
      vitamin_d_25oh  DOUBLE PRECISION,
      vitamin_e       DOUBLE PRECISION,
      vitamin_k       DOUBLE PRECISION,
      b1_thiamine     DOUBLE PRECISION,
      b2_riboflavin   DOUBLE PRECISION,
      b3_niacin       DOUBLE PRECISION,
      niacin_equivalents DOUBLE PRECISION,
      b5_pantothenic_acid DOUBLE PRECISION,
      b6_pyridoxine   DOUBLE PRECISION,
      b12_cobalamin   DOUBLE PRECISION,
      folate          DOUBLE PRECISION,
      calcium         DOUBLE PRECISION,
      chromium        DOUBLE PRECISION,
      copper          DOUBLE PRECISION,
      iron            DOUBLE PRECISION,
      magnesium       DOUBLE PRECISION,
      manganese       DOUBLE PRECISION,
      phosphorus      DOUBLE PRECISION,
      potassium       DOUBLE PRECISION,
      selenium        DOUBLE PRECISION,
      sodium          DOUBLE PRECISION,
      zinc            DOUBLE PRECISION,
      iodine          DOUBLE PRECISION,
      cystine         DOUBLE PRECISION,
      histidine       DOUBLE PRECISION,
      isoleucine      DOUBLE PRECISION,
      leucine         DOUBLE PRECISION,
      lysine          DOUBLE PRECISION,
      methionine      DOUBLE PRECISION,
      phenylalanine   DOUBLE PRECISION,
      threonine       DOUBLE PRECISION,
      tryptophan      DOUBLE PRECISION,
      tyrosine        DOUBLE PRECISION,
      valine          DOUBLE PRECISION,
      oxalate         DOUBLE PRECISION,
      phytate         DOUBLE PRECISION,
      ash             DOUBLE PRECISION,
      salt            DOUBLE PRECISION,
      sensitivities   TEXT[]
    )
  `,

  meal_food_items_indexes: `
    CREATE INDEX IF NOT EXISTS idx_meal_food_items_meal ON meal_food_items (meal_id);
    CREATE INDEX IF NOT EXISTS idx_meal_food_items_food ON meal_food_items (food_item_id)
  `,

  meals_indexes: `
    CREATE INDEX IF NOT EXISTS idx_meals_time ON meals (time DESC);
    CREATE INDEX IF NOT EXISTS idx_meals_type_time ON meals (meal_type, time DESC);
    CREATE INDEX IF NOT EXISTS idx_meals_source ON meals (source, time DESC)
  `,

  // User-defined sensitivity flags (dairy, gluten, alcohol, …). Per-user —
  // each user picks the labels they care about. Replaces the previous flat
  // `user_settings.sensitivity_areas: string[]` with a normalised table so
  // the `food_item_sensitivities` junction can carry FK integrity for the
  // flag side. (The food_item side is a soft pointer because targets may
  // live in the central shared library — same pattern as meal_food_items.)
  sensitivity_flags: `
    CREATE TABLE IF NOT EXISTS sensitivity_flags (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        VARCHAR(100) NOT NULL,
      color       VARCHAR(20),
      icon        TEXT,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT unique_sensitivity_flag_name UNIQUE (name)
    )
  `,
  sensitivity_flags_indexes: `
    CREATE INDEX IF NOT EXISTS idx_sensitivity_flags_sort ON sensitivity_flags (sort_order, name)
  `,

  // Junction: food item ↔ sensitivity flag. food_item_id is a soft pointer
  // (no FK) so users can attach flags to central shared library items too.
  // Cascades on the food_item side are handled in the application layer
  // (deleteFoodItem / mergeFoodItems); the flag side has a real FK with
  // ON DELETE CASCADE.
  food_item_sensitivities: `
    CREATE TABLE IF NOT EXISTS food_item_sensitivities (
      food_item_id          UUID NOT NULL,
      sensitivity_flag_id   UUID NOT NULL REFERENCES sensitivity_flags(id) ON DELETE CASCADE,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (food_item_id, sensitivity_flag_id)
    )
  `,
  food_item_sensitivities_indexes: `
    CREATE INDEX IF NOT EXISTS idx_food_item_sensitivities_food
      ON food_item_sensitivities (food_item_id);
    CREATE INDEX IF NOT EXISTS idx_food_item_sensitivities_flag
      ON food_item_sensitivities (sensitivity_flag_id)
  `,

  // Per-user customizations layered onto central shared_food_items rows. The
  // shared library is read-only from a user's perspective (a single LSV row
  // is the same for everyone), so when a user wants their own icon (or, in
  // the future, default_quantity / display name / etc.) we keep the central
  // row pristine and stash the overrides here. Each NULL column means "no
  // override applied" — the central value passes through. Designed to grow:
  // adding columns is an idempotent ALTER in connection.ts.
  //
  // Soft pointer on shared_food_item_id (no FK; central lives in another DB).
  shared_food_item_overrides: `
    CREATE TABLE IF NOT EXISTS shared_food_item_overrides (
      shared_food_item_id  UUID PRIMARY KEY,
      icon                 TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
}
