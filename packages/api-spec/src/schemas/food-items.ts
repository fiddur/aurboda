/**
 * Food item schemas — canonical food item library.
 *
 * Food items are first-class entities with their own table.
 * Meals reference food items via a junction table (meal_food_items).
 */

import { z } from 'zod'

import { baseResponseSchema, createDataArrayResponseSchema, createDataResponseSchema } from './common.ts'
import { foodItemPortionSchema } from './food-item-portions.ts'
import { nutrientFieldsSchema } from './nutrients.ts'

// ============================================================================
// Food Item Entity
// ============================================================================

/**
 * A canonical food item in the library.
 */
export const foodItemEntitySchema = nutrientFieldsSchema
  .extend({
    created_at: z.string().optional().meta({ description: 'Creation timestamp' }),
    default_quantity: z.number().optional().meta({ description: 'Default quantity (e.g., 1)' }),
    default_unit: z
      .string()
      .max(100)
      .optional()
      .meta({ description: 'Default unit (e.g., "g", "ml", "serving", "large slice")' }),
    icon: z
      .string()
      .max(2048)
      .optional()
      .meta({ description: 'Icon for this food item (emoji or image URL)' }),
    id: z.string().uuid().meta({ description: 'Food item ID' }),
    is_composite: z.boolean().optional().meta({
      description:
        'True if this is a composite (recipe) item — its nutrient values are derived from food_item_ingredients at read time.',
    }),
    reference_food_item_id: z.string().uuid().optional().meta({
      description:
        'Optional pointer to a richer canonical food item (typically a central library row, e.g. an LSV item) used to inherit empty micronutrient fields. Per-user atomic items only.',
    }),
    default_portion_id: z.string().uuid().optional().meta({
      description:
        'Portion (from food_item_portions) to preselect when this food is logged. NULL/absent means the base portion (default_quantity/default_unit) is preselected.',
    }),
    name: z.string().min(1).max(255).meta({ description: 'Food item name' }),
    source: z
      .string()
      .max(50)
      .optional()
      .meta({ description: 'Data source (e.g., "cronometer", "oura", "manual", "livsmedelsverket")' }),
    source_id: z
      .string()
      .max(100)
      .optional()
      .meta({ description: 'Stable identifier from the upstream source (e.g. LSV nummer)' }),
    updated_at: z.string().optional().meta({ description: 'Last update timestamp' }),
  })
  .meta({ description: 'A canonical food item with default nutritional data', id: 'FoodItemEntity' })

export type FoodItemEntity = z.infer<typeof foodItemEntitySchema>

// ============================================================================
// Composite (recipe) ingredients
// ============================================================================

/**
 * One ingredient line in a composite food item — points at another food
 * (per-user or central), with quantity + unit. The pointed-at food's
 * nutrients are scaled by quantity/default_quantity at read time to
 * contribute to the parent's totals.
 */
export const foodItemIngredientSchema = z
  .object({
    ingredient_food_item_id: z
      .string()
      .uuid()
      .meta({ description: 'ID of the food item used as an ingredient (per-user OR central library)' }),
    quantity: z.number().meta({ description: 'Amount used, in `unit`' }),
    unit: z.string().max(100).optional().meta({ description: 'Unit for quantity' }),
    sort_order: z
      .number()
      .int()
      .optional()
      .meta({ description: 'Display order; defaults to position in the input array' }),
  })
  .meta({ description: 'One ingredient of a composite food item', id: 'FoodItemIngredient' })

export type FoodItemIngredient = z.infer<typeof foodItemIngredientSchema>

/**
 * Replace the full ingredients list for a composite item.
 */
export const setFoodItemIngredientsBodySchema = z
  .object({
    ingredients: z
      .array(foodItemIngredientSchema)
      .meta({ description: 'Full list of ingredients — replaces any existing ones' }),
  })
  .meta({ description: 'Replace the ingredients of a composite food item', id: 'SetFoodItemIngredientsBody' })

export type SetFoodItemIngredientsBody = z.infer<typeof setFoodItemIngredientsBodySchema>

/**
 * A resolved ingredient as returned from the detail endpoint — the
 * junction row plus a snapshot of the ingredient food item's name/icon
 * for display.
 */
export const resolvedFoodItemIngredientSchema = foodItemIngredientSchema
  .extend({
    name: z.string().nullable().meta({
      description: 'Ingredient food name (null if the pointed-at item was deleted)',
    }),
    icon: z.string().nullable().meta({ description: 'Ingredient icon (or null)' }),
  })
  .meta({ description: 'A composite ingredient with display info', id: 'ResolvedFoodItemIngredient' })

export type ResolvedFoodItemIngredient = z.infer<typeof resolvedFoodItemIngredientSchema>

/**
 * Detail response for a single food item. For composites, includes the
 * ingredient list plus derived nutrient totals (sum of each ingredient's
 * value × quantity/default_quantity, when units match). For atomic items,
 * `ingredients` and `derived_nutrients` are absent and the entity's own
 * nutrient values are authoritative.
 */
export const fieldOriginSchema = z
  .object({
    origin: z.enum(['self', 'reference']).meta({
      description:
        '"self" if the value comes from this food item directly; "reference" if inherited from the referenced canonical item (scaled to this serving).',
    }),
    value: z.union([z.number(), z.string()]),
  })
  .meta({ description: 'Per-field origin info for a reference-enriched food item', id: 'FieldOrigin' })

export type FieldOrigin = z.infer<typeof fieldOriginSchema>

export const referencedFoodSchema = z
  .object({
    food: foodItemEntitySchema,
    unit_mismatch: z.boolean().meta({
      description:
        'True when the self item and reference have units that cannot be converted (e.g. "1 slice" vs "100 g") — inherited values are emitted at scale=1 with this flag so the UI can warn.',
    }),
  })
  .meta({ description: 'Resolved reference for an enriched food item', id: 'ReferencedFood' })

export type ReferencedFood = z.infer<typeof referencedFoodSchema>

export const referenceEnrichedFieldsSchema = z
  .object({
    fields: z.record(z.string(), fieldOriginSchema).meta({
      description:
        'Per-field origin map. Self values always win when set; reference values fill empty fields, scaled to the self serving.',
    }),
  })
  .meta({ id: 'ReferenceEnrichedFields' })

export type ReferenceEnrichedFields = z.infer<typeof referenceEnrichedFieldsSchema>

export const foodItemDetailSchema = foodItemEntitySchema
  .extend({
    is_shared: z.boolean().optional().meta({
      description:
        'True when this row lives in the central shared library (e.g. Livsmedelsverket). Such rows are read-only — clients must use the `/food-items/:id/override` endpoints (or `set_shared_food_item_override` MCP tool) to customize fields like icon, and PATCH/DELETE on the row itself will 403.',
    }),
    portions: z.array(foodItemPortionSchema).optional().meta({
      description: 'Extra portion sizings defined for this food item, sorted by sort_order.',
    }),
    effective_default_portion_id: z.string().uuid().optional().meta({
      description:
        'Resolved default portion id to preselect when logging this food. For per-user items this mirrors `default_portion_id` on the food row. For central items it falls back through `shared_food_item_overrides.default_portion_id` first, then the central row\'s own (currently absent) default. Absent when there is no default — the UI should preselect the implicit base portion.',
    }),
    ingredients: z.array(resolvedFoodItemIngredientSchema).optional(),
    derived_nutrients: z
      .object({
        values: z.record(z.string(), z.number()).meta({
          description: 'Summed nutrient values from the resolved ingredients',
        }),
        nutrient_data_incomplete: z.boolean().meta({
          description: 'True when one or more ingredients lack calorie data or could not be resolved',
        }),
      })
      .optional()
      .meta({ description: 'Nutrient totals derived from ingredients (composite items only)' }),
    reference: referencedFoodSchema.optional().meta({
      description: 'The referenced canonical food item (atomic items only).',
    }),
    reference_enriched: referenceEnrichedFieldsSchema.optional().meta({
      description: 'Per-field origin info when a reference is set.',
    }),
    sensitivities: z
      .array(z.object({ id: z.string().uuid(), name: z.string(), color: z.string().nullable().optional() }))
      .optional()
      .meta({
        description:
          'Sensitivity flags assigned to this food item (e.g. dairy, gluten). Resolved from food_item_sensitivities; supports user + central items.',
      }),
  })
  .meta({ description: 'Food item detail with optional composite ingredients', id: 'FoodItemDetail' })

export type FoodItemDetail = z.infer<typeof foodItemDetailSchema>

export const setFoodItemReferenceBodySchema = z
  .object({
    reference_food_item_id: z.string().uuid().nullable().meta({
      description:
        'ID of the food item to reference (per-user OR central). Pass null to clear the reference.',
    }),
  })
  .meta({ description: 'Set or clear the reference_food_item_id pointer', id: 'SetFoodItemReferenceBody' })

export type SetFoodItemReferenceBody = z.infer<typeof setFoodItemReferenceBodySchema>

// ============================================================================
// Shared (central) food-item overrides
// ============================================================================

/**
 * Per-user customization layered onto a central shared food-item row. The
 * central library is read-only from a user's perspective, so any per-user
 * tweaks (icon today, more fields later) live in this side-table. Each
 * absent field on the response means "no override applied — central value
 * passes through"; an explicit `null` (e.g. `icon: null`) means the user
 * wants no value, hiding the central one.
 */
export const sharedFoodItemOverrideSchema = z
  .object({
    shared_food_item_id: z
      .string()
      .uuid()
      .meta({ description: 'ID of the central shared food item this override applies to' }),
    icon: z.string().max(2048).nullable().meta({
      description: 'User-set icon for the central item; null means "no icon" (explicit override to empty).',
    }),
    default_portion_id: z.string().uuid().nullable().meta({
      description:
        'User-preselected portion id for the central item; null means no override (fall through to the central row\'s own default_portion_id).',
    }),
    created_at: z.string().meta({ description: 'Override creation timestamp' }),
    updated_at: z.string().meta({ description: 'Override last-update timestamp' }),
  })
  .meta({
    description: 'Per-user override of fields on a central shared food item',
    id: 'SharedFoodItemOverride',
  })

export type SharedFoodItemOverride = z.infer<typeof sharedFoodItemOverrideSchema>

/**
 * Body for upserting an override. Fields are independently optional —
 * omitting a field leaves it untouched on an existing row; passing `null`
 * writes "no value" semantics for that field.
 *
 * At least one override field must be supplied. An empty body is rejected
 * because it would otherwise create a row with every column NULL, which
 * the read path cannot distinguish from "user explicitly chose no value"
 * — silently hiding the central icon. To revert to central, call
 * DELETE /:id/override (or `clear_shared_food_item_override` over MCP).
 */
export const setSharedFoodItemOverrideBodySchema = z
  .object({
    icon: z.string().max(2048).nullable().optional().meta({
      description:
        'Override icon for the central item. String sets the icon, null hides the central icon, omitted leaves the column unchanged.',
    }),
    default_portion_id: z.string().uuid().nullable().optional().meta({
      description:
        'Override preselected portion id. String sets the override, null clears any prior override (falls through to the central default), omitted leaves the column unchanged.',
    }),
  })
  .refine((body) => body.icon !== undefined || body.default_portion_id !== undefined, {
    message: 'At least one override field must be supplied; clear via DELETE to revert to central',
  })
  .meta({
    description: 'Upsert per-user override columns for a central shared food item',
    id: 'SetSharedFoodItemOverrideBody',
  })

export type SetSharedFoodItemOverrideBody = z.infer<typeof setSharedFoodItemOverrideBodySchema>

export const sharedFoodItemOverrideResponseSchema = createDataResponseSchema(
  sharedFoodItemOverrideSchema,
).meta({ id: 'SharedFoodItemOverrideResponse' })

export type SharedFoodItemOverrideResponse = z.infer<typeof sharedFoodItemOverrideResponseSchema>

// ============================================================================
// Request Schemas
// ============================================================================

/**
 * Add food item request body.
 */
export const addFoodItemBodySchema = nutrientFieldsSchema
  .extend({
    default_quantity: z.number().optional().meta({ description: 'Default quantity' }),
    default_unit: z.string().max(100).optional().meta({ description: 'Default unit' }),
    icon: z.string().optional().meta({ description: 'Icon (emoji or image URL)' }),
    name: z.string().min(1).max(255).meta({ description: 'Food item name' }),
    source: z.string().max(50).optional().meta({ description: 'Data source' }),
  })
  .meta({ description: 'Create a canonical food item', id: 'AddFoodItemBody' })

export type AddFoodItemBody = z.infer<typeof addFoodItemBodySchema>

/**
 * Update food item request body — all fields optional.
 *
 * `default_portion_id` is intentionally excluded: setting it requires a
 * cross-validation step ("the portion must belong to this food") that the
 * generic update path can't enforce without duplicating service logic.
 * Use the dedicated `PUT /food-items/:id/default-portion` endpoint (or the
 * `set_default_food_item_portion` MCP tool) instead.
 */
export const updateFoodItemBodySchema = nutrientFieldsSchema
  .extend({
    default_quantity: z.number().nullable().optional(),
    default_unit: z.string().max(100).nullable().optional(),
    icon: z.string().max(2048).nullable().optional(),
    name: z.string().min(1).max(255).optional(),
  })
  .meta({ description: 'Update a food item — only provided fields are changed', id: 'UpdateFoodItemBody' })

export type UpdateFoodItemBody = z.infer<typeof updateFoodItemBodySchema>

/**
 * Food items query — search by name prefix.
 */
export const foodItemsQuerySchema = z
  .object({
    limit: z.string().optional().meta({ description: 'Max results (default 20)' }),
    q: z.string().optional().meta({ description: 'Search query (prefix match on name)' }),
  })
  .meta({ description: 'Query parameters for searching food items', id: 'FoodItemsQuery' })

export type FoodItemsQuery = z.infer<typeof foodItemsQuerySchema>

// ============================================================================
// Response Schemas
// ============================================================================

export const foodItemResponseSchema = createDataResponseSchema(foodItemEntitySchema).meta({
  id: 'FoodItemResponse',
})

export type FoodItemResponse = z.infer<typeof foodItemResponseSchema>

export const foodItemDetailResponseSchema = createDataResponseSchema(foodItemDetailSchema).meta({
  id: 'FoodItemDetailResponse',
})

export type FoodItemDetailResponse = z.infer<typeof foodItemDetailResponseSchema>

export const foodItemsResponseSchema = createDataArrayResponseSchema(foodItemEntitySchema).meta({
  id: 'FoodItemsResponse',
})

export type FoodItemsResponse = z.infer<typeof foodItemsResponseSchema>

export const deleteFoodItemResponseSchema = baseResponseSchema.meta({ id: 'DeleteFoodItemResponse' })

export type DeleteFoodItemResponse = z.infer<typeof deleteFoodItemResponseSchema>

// ============================================================================
// Re-snapshot meals
// ============================================================================

export const resnapshotMealsResultSchema = z
  .object({
    meals_updated: z.number().int().min(0).meta({
      description: 'Number of distinct meals that had at least one row re-snapshotted',
    }),
    rows_updated: z.number().int().min(0).meta({
      description: 'Number of meal_food_items junction rows whose nutrient values were refreshed',
    }),
  })
  .meta({ description: 'Outcome of re-snapshotting historical meals', id: 'ResnapshotMealsResult' })

export type ResnapshotMealsResult = z.infer<typeof resnapshotMealsResultSchema>

export const resnapshotMealsResponseSchema = createDataResponseSchema(resnapshotMealsResultSchema).meta({
  id: 'ResnapshotMealsResponse',
})

export type ResnapshotMealsResponse = z.infer<typeof resnapshotMealsResponseSchema>

// ============================================================================
// Merge food items
// ============================================================================

export const mergeFoodItemsQuerySchema = z
  .object({
    source_id: z.string().uuid().meta({ description: 'Food item being merged away (must be per-user)' }),
  })
  .meta({ id: 'MergeFoodItemsQuery' })

export type MergeFoodItemsQuery = z.infer<typeof mergeFoodItemsQuerySchema>

export const mergeFillCandidateSchema = z
  .object({
    field: z.string().meta({ description: 'Nutrient column or icon/default_* field name' }),
    source_value: z
      .union([z.number(), z.string()])
      .meta({ description: 'Value the source has and the target lacks' }),
  })
  .meta({ description: 'A field the source has and the target does not', id: 'MergeFillCandidate' })

export type MergeFillCandidate = z.infer<typeof mergeFillCandidateSchema>

export const mergeFoodItemsPreviewSchema = z
  .object({
    source_id: z.string().uuid(),
    target_id: z.string().uuid(),
    source_name: z.string(),
    target_name: z.string(),
    target_is_central: z.boolean().meta({
      description:
        'Target lives in the central shared library — read-only, so the fill-empty option must not be offered.',
    }),
    meals_repointed: z.number().int(),
    ingredients_repointed: z.number().int(),
    source_is_composite: z.boolean().meta({
      description: 'Source has its own ingredients which will be discarded on merge.',
    }),
    fill_candidates: z.array(mergeFillCandidateSchema),
  })
  .meta({ description: 'What a merge would do, computed before commit.', id: 'MergeFoodItemsPreview' })

export type MergeFoodItemsPreview = z.infer<typeof mergeFoodItemsPreviewSchema>

export const mergeFoodItemsPreviewResponseSchema = createDataResponseSchema(mergeFoodItemsPreviewSchema).meta(
  { id: 'MergeFoodItemsPreviewResponse' },
)

export type MergeFoodItemsPreviewResponse = z.infer<typeof mergeFoodItemsPreviewResponseSchema>

export const mergeFoodItemsBodySchema = z
  .object({
    source_id: z.string().uuid().meta({ description: 'Food item being merged away (must be per-user)' }),
    fill_empty: z.boolean().optional().meta({
      description: 'When true, fill empty target fields from source values. Ignored when target is central.',
    }),
    confirm_discard_ingredients: z.boolean().optional().meta({
      description:
        "Required when source has its own ingredients (composite recipe). Acknowledges they'll be discarded.",
    }),
  })
  .meta({
    description: 'Merge a per-user food item into another (per-user or central).',
    id: 'MergeFoodItemsBody',
  })

export type MergeFoodItemsBody = z.infer<typeof mergeFoodItemsBodySchema>

export const mergeFoodItemsResultSchema = z
  .object({
    meals_repointed: z.number().int(),
    ingredients_repointed: z.number().int(),
    fills_applied: z.array(z.string()),
    source_was_composite: z.boolean(),
    target_is_central: z.boolean(),
  })
  .meta({ id: 'MergeFoodItemsResult' })

export type MergeFoodItemsResult = z.infer<typeof mergeFoodItemsResultSchema>

export const mergeFoodItemsResponseSchema = createDataResponseSchema(mergeFoodItemsResultSchema).meta({
  id: 'MergeFoodItemsResponse',
})

export type MergeFoodItemsResponse = z.infer<typeof mergeFoodItemsResponseSchema>
