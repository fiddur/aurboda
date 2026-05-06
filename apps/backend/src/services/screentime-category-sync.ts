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
 * `activity_type` automatically. Multiple categories may also share a slug
 * (Sport > Tennis and Hobby > Tennis both → `tennis`); the
 * `activity_type_name` column is therefore intentionally non-unique.
 */

import type { ScreentimeCategory } from '../db/index.ts'

import { query } from '../db/connection.ts'
import { auditInfo, auditWarn } from './audit-log.ts'
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

/**
 * Existing activity_type names, partitioned by builtin status. Mutable: the
 * caller adds to `nonBuiltin` after every successful insert so subsequent
 * categories see the just-minted slugs without a re-query.
 */
interface ExistingTypeNames {
  builtin: Set<string>
  nonBuiltin: Set<string>
}

const loadExistingTypeNames = async (user: string): Promise<ExistingTypeNames> => {
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

const persistSlugOnCategory = async (
  user: string,
  categoryId: string,
  slug: string,
  ownsType: boolean,
): Promise<void> => {
  await query(
    user,
    `UPDATE screentime_categories
       SET activity_type_name = $1, category_owns_type = $2, updated_at = NOW()
     WHERE id = $3`,
    [slug, ownsType, categoryId],
  )
}

/**
 * Insert a derived activity_type row, using ON CONFLICT to tolerate a
 * concurrent sync that just inserted the same slug. Returns true if we
 * inserted, false if a concurrent writer beat us to it.
 */
const insertDerivedType = async (
  user: string,
  slug: string,
  displayName: string,
  color: string | undefined,
  parentSlug: string | null,
): Promise<boolean> => {
  // ON CONFLICT (name) DO NOTHING — the (RescueTime push, ActivityWatch push)
  // two-syncs-at-once case computes the same slug for the same category, and
  // without this the loser fails the whole sync.
  const aliases = [slug.toLowerCase()]
  const result = await query(
    user,
    `INSERT INTO activity_type_definitions
       (name, display_name, display_category, color, aliases, show_on_timeline, parent_type)
     VALUES ($1, $2, 'productivity', COALESCE($3, '#6b7280'), $4, true, $5)
     ON CONFLICT (name) DO NOTHING
     RETURNING name`,
    [slug, displayName, color ?? null, aliases, parentSlug],
  )
  return (result.rowCount ?? 0) > 0
}

/**
 * Ensure a category has a linked activity_type_definitions row.
 *
 * Idempotent: if the category already has `activity_type_name`, returns it.
 * Otherwise generates a slug, inserts a new type def (or links to an existing
 * non-builtin same-name type), and persists the slug on the category.
 *
 * `existing` is mutated in place — when a fresh slug is minted, it's added to
 * the non-builtin set so subsequent same-batch categories see it.
 */
export const ensureCategoryHasType = async (
  user: string,
  category: ScreentimeCategory,
  allCategories: ScreentimeCategory[],
  existing?: ExistingTypeNames,
): Promise<string> => {
  if (category.activity_type_name) return category.activity_type_name

  const parent = findParentCategory(category, allCategories)
  let parentSlug: string | null = null
  if (parent) {
    parentSlug =
      parent.activity_type_name ?? (await ensureCategoryHasType(user, parent, allCategories, existing))
  }

  const types = existing ?? (await loadExistingTypeNames(user))
  const leaf = category.name[category.name.length - 1]
  const { slug, linkToExisting } = generateSlug(leaf, parentSlug, {
    existingBuiltin: types.builtin,
    existingNonBuiltin: types.nonBuiltin,
  })

  let ownsType: boolean
  if (linkToExisting) {
    ownsType = false
    // Audit-log convergence so users can debug why their category color/name
    // didn't take effect on the type def.
    auditInfo(user, 'data', 'Screentime category linked to existing activity type', {
      category_id: category.id,
      category_path: category.name.join(' > '),
      slug,
    })
  } else {
    const inserted = await insertDerivedType(user, slug, leaf, category.color, parentSlug)
    if (!inserted) {
      // Concurrent writer minted this slug first. The slug exists; we link
      // (and disclaim ownership of parent_type since the racer owns it).
      ownsType = false
      auditWarn(user, 'data', 'Concurrent insert beat us; linking to type minted by sibling sync', {
        category_id: category.id,
        slug,
      })
    } else {
      ownsType = true
    }
    types.nonBuiltin.add(slug)
  }

  await persistSlugOnCategory(user, category.id, slug, ownsType)
  category.activity_type_name = slug
  category.category_owns_type = ownsType
  return slug
}

/**
 * Bulk-ensure: every category gets a slug + type def. Iterates depth-first so
 * parents are minted before children — `ensureCategoryHasType` then sees a
 * resolved parent slug locally without recursing. The existing-types snapshot
 * is loaded once and threaded through to avoid an N+1 lookup.
 */
export const ensureAllCategoriesHaveTypes = async (
  user: string,
  categories: ScreentimeCategory[],
): Promise<void> => {
  if (categories.length === 0) return
  const existing = await loadExistingTypeNames(user)
  const sorted = [...categories].sort((a, b) => a.name.length - b.name.length)
  for (const cat of sorted) {
    await ensureCategoryHasType(user, cat, sorted, existing)
  }
}

/**
 * Returns true when this category alone owns the activity_type — it created
 * the type def itself (`category_owns_type=true`), no other category links to
 * the same slug, and no deduction rule outputs it. Activities of that type
 * are by extension also "ours" because nothing else could have produced them.
 */
const isTypeSolelyOwnedByCategory = async (user: string, category: ScreentimeCategory): Promise<boolean> => {
  if (!category.activity_type_name) return false
  if (!category.category_owns_type) return false // converged onto a pre-existing type
  const result = await query<{ cat_count: string; has_rule: boolean }>(
    user,
    `SELECT
       (SELECT COUNT(*)::int FROM screentime_categories
          WHERE activity_type_name = $1 AND id <> $2) AS cat_count,
       EXISTS(SELECT 1 FROM deduction_rules WHERE output_activity_type = $1) AS has_rule`,
    [category.activity_type_name, category.id],
  )
  if (result.rows.length === 0) return false
  const otherCatCount = Number(result.rows[0].cat_count)
  const hasRule = result.rows[0].has_rule
  return otherCatCount === 0 && !hasRule
}

/**
 * After a category is moved (its `name[]` prefix changed), update the linked
 * type def's `parent_type` so the type hierarchy mirrors the category
 * hierarchy. The slug itself is stable — only `parent_type` walks.
 *
 * Skipped when the type is shared (this category linked rather than created,
 * other categories link, or a deduction rule outputs it). Reorganizing a
 * shared hierarchy on behalf of one consumer would silently change collapse
 * behaviour for unrelated activities.
 *
 * The raw UPDATE bypasses validateParentTypeUpdate; cycles can't form here
 * because the new parent_type is derived from the category tree, which is a
 * DAG by construction.
 */
export const recomputeCategoryParentType = async (
  user: string,
  category: ScreentimeCategory,
  allCategories: ScreentimeCategory[],
): Promise<void> => {
  if (!category.activity_type_name) return // not yet linked — nothing to recompute
  const owned = await isTypeSolelyOwnedByCategory(user, category)
  if (!owned) {
    auditInfo(user, 'data', 'Skipped parent_type update on shared activity type', {
      category_id: category.id,
      slug: category.activity_type_name,
    })
    return
  }
  const parent = findParentCategory(category, allCategories)
  const newParentSlug = parent?.activity_type_name ?? null
  await query(
    user,
    `UPDATE activity_type_definitions SET parent_type = $1, updated_at = NOW() WHERE name = $2`,
    [newParentSlug, category.activity_type_name],
  )
}
