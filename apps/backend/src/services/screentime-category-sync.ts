/**
 * Mirror screentime categories into `activity_type_definitions`.
 *
 * The category row owns a stable slug (`activity_type_name`) set once at first
 * sync. The type-definition row carries the display metadata used by the
 * timeline / queries / hierarchy collapse. Together they replace the v1 model
 * where every screentime span had `activity_type='screentime'` regardless of
 * category.
 *
 * Convergence: a category whose leaf name slugifies to an already-existing
 * non-builtin type (e.g. a `tv` deduction-rule type) links to that type
 * instead of creating a parallel one. This is the design payoff — a `tv`
 * screentime category and a `tv` deduction-rule activity merge into a single
 * `activity_type` automatically.
 */

import type { ScreentimeCategory } from '../db/index.ts'

import { query } from '../db/connection.ts'
import { insertActivityTypeDefinition } from '../db/index.ts'
import { generateSlug } from './screentime-category-slug.ts'

const findParentCategory = (
  category: ScreentimeCategory,
  all: ScreentimeCategory[],
): ScreentimeCategory | null => {
  if (category.name.length <= 1) return null
  const parentPath = category.name.slice(0, -1)
  return (
    all.find((c) => c.name.length === parentPath.length && c.name.every((seg, i) => seg === parentPath[i])) ??
    null
  )
}

const loadExistingTypeNames = async (
  user: string,
): Promise<{ builtin: Set<string>; nonBuiltin: Set<string> }> => {
  const result = await query<{ name: string; is_builtin: boolean }>(
    user,
    `SELECT name, is_builtin FROM activity_type_definitions`,
  )
  const builtin = new Set<string>()
  const nonBuiltin = new Set<string>()
  for (const row of result.rows) {
    if (row.is_builtin) builtin.add(row.name)
    else nonBuiltin.add(row.name)
  }
  return { builtin, nonBuiltin }
}

const persistSlugOnCategory = async (user: string, categoryId: string, slug: string): Promise<void> => {
  await query(
    user,
    `UPDATE screentime_categories SET activity_type_name = $1, updated_at = NOW() WHERE id = $2`,
    [slug, categoryId],
  )
}

/**
 * Ensure a category has a linked activity_type_definitions row.
 *
 * Idempotent: if the category already has `activity_type_name`, returns it.
 * Otherwise generates a slug, inserts a new type def (or links to an existing
 * non-builtin same-name type), and persists the slug on the category.
 *
 * Caller passes the full category list so the parent path can be resolved
 * locally — depth-ordered iteration in `ensureAllCategoriesHaveTypes` mutates
 * the list as slugs are minted, so each child can read its parent's slug.
 */
export const ensureCategoryHasType = async (
  user: string,
  category: ScreentimeCategory,
  allCategories: ScreentimeCategory[],
): Promise<string> => {
  if (category.activity_type_name) return category.activity_type_name

  const parent = findParentCategory(category, allCategories)
  let parentSlug: string | null = null
  if (parent) {
    parentSlug = parent.activity_type_name ?? (await ensureCategoryHasType(user, parent, allCategories))
  }

  const { builtin, nonBuiltin } = await loadExistingTypeNames(user)
  const leaf = category.name[category.name.length - 1]
  const { slug, linkToExisting } = generateSlug(leaf, parentSlug, {
    existingBuiltin: builtin,
    existingNonBuiltin: nonBuiltin,
  })

  if (!linkToExisting) {
    await insertActivityTypeDefinition(user, {
      display_category: 'productivity',
      display_name: leaf,
      name: slug,
      ...(category.color !== undefined ? { color: category.color } : {}),
      ...(parentSlug !== null ? { parent_type: parentSlug } : {}),
    })
  }

  await persistSlugOnCategory(user, category.id, slug)
  category.activity_type_name = slug
  return slug
}

/**
 * Bulk-ensure: every category gets a slug + type def. Iterates depth-first so
 * parents are minted before children — `ensureCategoryHasType` then sees a
 * resolved parent slug locally without recursing.
 */
export const ensureAllCategoriesHaveTypes = async (
  user: string,
  categories: ScreentimeCategory[],
): Promise<void> => {
  const sorted = [...categories].sort((a, b) => a.name.length - b.name.length)
  for (const cat of sorted) {
    await ensureCategoryHasType(user, cat, sorted)
  }
}

/**
 * After a category is moved (its `name[]` prefix changed), update the linked
 * type def's `parent_type` so the type hierarchy mirrors the category
 * hierarchy. The slug itself is stable — only `parent_type` walks.
 */
export const recomputeCategoryParentType = async (
  user: string,
  category: ScreentimeCategory,
  allCategories: ScreentimeCategory[],
): Promise<void> => {
  if (!category.activity_type_name) return // not yet linked — nothing to recompute
  const parent = findParentCategory(category, allCategories)
  const newParentSlug = parent?.activity_type_name ?? null
  await query(
    user,
    `UPDATE activity_type_definitions SET parent_type = $1, updated_at = NOW() WHERE name = $2`,
    [newParentSlug, category.activity_type_name],
  )
}
