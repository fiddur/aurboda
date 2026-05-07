/**
 * Screentime category service.
 *
 * Handles CRUD, category resolution (matching app/title against rules), and
 * bulk recategorization of productivity records when rules change.
 *
 * Resolution algorithm (matches ActivityWatch):
 * - Each category has a regex rule tested against both activity name and window title
 * - If multiple categories match, the deepest one (longest name path) wins
 * - Categories with rule_type 'none' never match directly (but children can)
 */
import type { AwCategory, CreateScreentimeCategoryBody } from '@aurboda/api-spec'

import type { ScreentimeCategory, ScreentimeCategoryInput } from '../db/types.ts'

import {
  batchUpdateResolvedCategory,
  bulkInsertScreentimeCategories,
  deleteAllScreentimeCategories,
  deleteScreentimeCategoryWithChildren,
  getAllProductivityForCategorization,
  getScreentimeCategories,
  getScreentimeCategoryById,
  insertScreentimeCategory,
  moveScreentimeCategory,
  updateScreentimeActivityCategoryPath,
  updateScreentimeCategory,
  upsertScreentimeCategory,
} from '../db/index.ts'
import { auditError, auditInfo } from './audit-log.ts'
import {
  ensureAllCategoriesHaveTypes,
  ensureCategoryHasType,
  recomputeCategoryParentType,
  syncTypeDefMetadataIfOwned,
} from './screentime-category-sync.ts'

/** "Work > Programming" — the joined-string form stored in `activities.data.category_path`. */
const joinPath = (name: string[]): string => name.join(' > ')

/** Best-effort propagation of a category rename or move to existing screentime
 *  activities. Updates `data.category_path` from the old joined string to the
 *  new one for activities under this category's slug. Logged on success;
 *  failures are audit-logged so the CRUD response isn't blocked.
 */
const propagateCategoryPath = async (
  user: string,
  slug: string | undefined,
  oldName: string[],
  newName: string[],
): Promise<void> => {
  if (!slug) return
  const oldPath = joinPath(oldName)
  const newPath = joinPath(newName)
  if (oldPath === newPath) return
  try {
    const updated = await updateScreentimeActivityCategoryPath(user, slug, oldPath, newPath)
    if (updated > 0) {
      auditInfo(user, 'data', 'Updated screentime activities for category rename/move', {
        new_path: newPath,
        old_path: oldPath,
        slug,
        updated,
      })
    }
  } catch (err) {
    console.error(`⚠️ Failed to propagate category path change for slug ${slug}:`, err)
    auditError(user, 'data', 'Failed to propagate category path change', {
      error: String(err),
      slug,
    })
  }
}

// ============================================================================
// Category Resolution
// ============================================================================

interface CompiledRule {
  category: ScreentimeCategory
  regex: RegExp
}

/**
 * Compile all regex-type categories into RegExp objects for matching.
 */
export const compileRules = (categories: ScreentimeCategory[]): CompiledRule[] =>
  categories
    .filter((c) => c.rule_type === 'regex' && c.rule_regex)
    .map((c) => ({
      category: c,
      regex: new RegExp(c.rule_regex!, (c.ignore_case ? 'i' : '') + 'm'),
    }))

/**
 * Resolve which category an activity/title belongs to.
 * Returns the deepest matching category's name path, or null if no match.
 *
 * Algorithm: test regex against both activity and title strings.
 * If multiple match, pick the deepest (longest name array).
 */
export const resolveCategory = (
  activity: string,
  title: string | undefined | null,
  compiledRules: CompiledRule[],
): string[] | null => {
  const matches = compiledRules.filter(
    (rule) => rule.regex.test(activity) || (title && rule.regex.test(title)),
  )

  if (matches.length === 0) return null

  // Pick deepest (most specific) match
  let deepest = matches[0]
  for (let i = 1; i < matches.length; i++) {
    if (matches[i].category.name.length > deepest.category.name.length) {
      deepest = matches[i]
    }
  }

  return deepest.category.name
}

/**
 * Resolve the effective color for a category path by walking up parents.
 * Returns the first color found, or undefined if none set.
 */
export const getColorForCategory = (
  categoryPath: string[],
  allCategories: ScreentimeCategory[],
): string | undefined => {
  // Try exact match first
  const exact = allCategories.find(
    (c) => c.name.length === categoryPath.length && c.name.every((n, i) => n === categoryPath[i]),
  )
  if (exact?.color) return exact.color

  // Walk up parents
  for (let depth = categoryPath.length - 1; depth > 0; depth--) {
    const parentPath = categoryPath.slice(0, depth)
    const parent = allCategories.find(
      (c) => c.name.length === parentPath.length && c.name.every((n, i) => n === parentPath[i]),
    )
    if (parent?.color) return parent.color
  }

  return undefined
}

/**
 * Resolve the effective score for a category path by walking up parents.
 */
export const getScoreForCategory = (
  categoryPath: string[],
  allCategories: ScreentimeCategory[],
): number | undefined => {
  const exact = allCategories.find(
    (c) => c.name.length === categoryPath.length && c.name.every((n, i) => n === categoryPath[i]),
  )
  if (exact?.score != null) return exact.score

  for (let depth = categoryPath.length - 1; depth > 0; depth--) {
    const parentPath = categoryPath.slice(0, depth)
    const parent = allCategories.find(
      (c) => c.name.length === parentPath.length && c.name.every((n, i) => n === parentPath[i]),
    )
    if (parent?.score != null) return parent.score
  }

  return undefined
}

// ============================================================================
// Recategorization
// ============================================================================

const BATCH_SIZE = 500

/**
 * Recategorize all productivity records for a user.
 * Loads all records, resolves categories, and batch updates.
 */
export const recategorizeAll = async (user: string): Promise<number> => {
  const categories = await getScreentimeCategories(user)
  const compiledRules = compileRules(categories)

  const records = await getAllProductivityForCategorization(user)
  if (records.length === 0) return 0

  let updated = 0

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE)
    const updates = batch.map((r) => ({
      id: r.id,
      resolved_category: resolveCategory(r.activity, r.title, compiledRules),
    }))

    await batchUpdateResolvedCategory(user, updates)
    updated += updates.length
  }

  return updated
}

/**
 * Resolve categories for a batch of productivity records (for use during sync insert).
 * Mutates the records in place by setting resolved_category.
 */
export const categorizeRecords = (
  records: Array<{ activity: string; title?: string; resolved_category?: string[] | null }>,
  compiledRules: CompiledRule[],
): void => {
  for (const record of records) {
    record.resolved_category = resolveCategory(record.activity, record.title, compiledRules) ?? undefined
  }
}

// ============================================================================
// CRUD (thin wrappers around DB with recategorization triggers)
// ============================================================================

export const listCategories = async (user: string) => getScreentimeCategories(user)

export const createCategory = async (user: string, input: ScreentimeCategoryInput) => {
  const result = await insertScreentimeCategory(user, input)

  // Mirror into activity_type_definitions so screentime activities for this
  // category will use a derived type (one type per category) instead of the
  // generic `screentime` umbrella.
  try {
    const all = await getScreentimeCategories(user)
    const slug = await ensureCategoryHasType(user, result, all)
    result.activity_type_name = slug
  } catch (err) {
    // Log to stderr too — auditError alone hides this from runtime dashboards.
    console.error(`⚠️ Failed to mirror screentime category ${result.id} to activity type:`, err)
    auditError(user, 'data', 'Failed to mirror category to activity type', { error: String(err) })
  }

  // Fire-and-forget recategorization (only if the new category has a rule)
  if (input.rule_type === 'regex' && input.rule_regex) {
    recategorizeAll(user).catch((err) => {
      auditError(user, 'data', 'Recategorization failed', { error: String(err) })
    })
  }

  return result
}

export const modifyCategory = async (user: string, id: string, input: Partial<ScreentimeCategoryInput>) => {
  // Snapshot the pre-update path so we can propagate any rename to existing
  // screentime activities (#652). Skip if the row didn't exist; updateScreentimeCategory
  // returns null in that case anyway.
  const before = await getScreentimeCategoryById(user, id)
  const result = await updateScreentimeCategory(user, id, input)

  // Propagate rename / color change to existing data (#652).
  if (before && result) {
    if (input.name !== undefined) {
      await propagateCategoryPath(user, result.activity_type_name, before.name, result.name)
    }
    if (input.name !== undefined || input.color !== undefined) {
      try {
        await syncTypeDefMetadataIfOwned(user, result)
      } catch (err) {
        console.error(`⚠️ Failed to sync type-def metadata for category ${id}:`, err)
        auditError(user, 'data', 'Failed to sync type-def metadata', { error: String(err) })
      }
    }
  }

  // Recategorize if rules or name changed (any of these affect resolution)
  if (
    input.rule_type !== undefined ||
    input.rule_regex !== undefined ||
    input.ignore_case !== undefined ||
    input.name !== undefined
  ) {
    recategorizeAll(user).catch((err) => {
      auditError(user, 'data', 'Recategorization failed', { error: String(err) })
    })
  }

  return result
}

/**
 * Delete a screentime category (and its descendants). v1 of #652 leaves
 * existing screentime activities and the linked `activity_type_definitions`
 * row in place: deleting historical bars would lose data the user might
 * still want to query, and the type def is harmless when orphaned (the
 * post-#728 timeline frontend handles a missing linked-category gracefully
 * via the `def`-based fallback path). Future iterations could offer
 * soft-delete or reassignment as opt-in user actions.
 */
export const removeCategory = async (user: string, id: string) => {
  const count = await deleteScreentimeCategoryWithChildren(user, id)

  if (count > 0) {
    recategorizeAll(user).catch((err) => {
      auditError(user, 'data', 'Recategorization failed', { error: String(err) })
    })
  }

  return count
}

export const getCategoryById = async (user: string, id: string) => getScreentimeCategoryById(user, id)

export const upsertCategory = async (user: string, id: string, input: ScreentimeCategoryInput) => {
  const before = await getScreentimeCategoryById(user, id)
  const result = await upsertScreentimeCategory(user, id, input)

  // Mirror into activity_type_definitions (idempotent — no-op if already linked).
  try {
    const all = await getScreentimeCategories(user)
    const slug = await ensureCategoryHasType(user, result, all)
    result.activity_type_name = slug
  } catch (err) {
    console.error(`⚠️ Failed to mirror screentime category ${result.id} to activity type:`, err)
    auditError(user, 'data', 'Failed to mirror category to activity type', { error: String(err) })
  }

  // Propagate rename / color change to existing data (#652). `before` is null
  // on the create branch of upsert; in that case there's nothing to propagate.
  if (before) {
    await propagateCategoryPath(user, result.activity_type_name, before.name, result.name)
    try {
      await syncTypeDefMetadataIfOwned(user, result)
    } catch (err) {
      console.error(`⚠️ Failed to sync type-def metadata for category ${id}:`, err)
      auditError(user, 'data', 'Failed to sync type-def metadata', { error: String(err) })
    }
  }

  // Recategorize if the category has a rule
  if (input.rule_type === 'regex' && input.rule_regex) {
    recategorizeAll(user).catch((err) => {
      auditError(user, 'data', 'Recategorization failed', { error: String(err) })
    })
  }

  return result
}

export const moveCategoryToParent = async (user: string, id: string, newParentId: string | null) => {
  // Resolve the new parent's name path (null = move to top level)
  const newParentName = newParentId
    ? ((await getScreentimeCategoryById(user, newParentId))?.name ?? null)
    : null

  // Snapshot all categories *before* the move so we can compute old paths for
  // the moved category AND its descendants (whose array prefix shifts during
  // moveScreentimeCategory).
  const before = await getScreentimeCategories(user)
  const movedBefore = before.find((c) => c.id === id)
  const descendantsBefore =
    movedBefore !== undefined
      ? before.filter(
          (c) =>
            c.id !== id &&
            c.name.length > movedBefore.name.length &&
            movedBefore.name.every((seg, i) => c.name[i] === seg),
        )
      : []

  const result = await moveScreentimeCategory(user, id, newParentName)

  if (result.updated > 0 && movedBefore) {
    // Recompute parent_type for the moved category and any descendants whose
    // path prefix changed. Slugs themselves are stable; only `parent_type`
    // walks to mirror the new hierarchy.
    try {
      const after = await getScreentimeCategories(user)
      const moved = after.find((c) => c.id === id)
      if (moved) {
        await recomputeCategoryParentType(user, moved, after)
        const descendants = after.filter(
          (c) =>
            c.id !== id &&
            c.name.length > moved.name.length &&
            moved.name.every((seg, i) => c.name[i] === seg),
        )
        for (const desc of descendants) await recomputeCategoryParentType(user, desc, after)

        // Propagate path changes to existing screentime activities (#652).
        // The moved category's path always changes; descendants' paths shift
        // by the prefix delta. Match each old/new pair by id so we cover the
        // descendants whose name array was rewritten in DB.
        await propagateCategoryPath(user, moved.activity_type_name, movedBefore.name, moved.name)
        for (const descBefore of descendantsBefore) {
          const descAfter = after.find((c) => c.id === descBefore.id)
          if (!descAfter) continue
          await propagateCategoryPath(user, descAfter.activity_type_name, descBefore.name, descAfter.name)
        }
      }
    } catch (err) {
      console.error('⚠️ Failed to recompute activity-type parent after move:', err)
      auditError(user, 'data', 'Failed to recompute activity-type parent after move', {
        error: String(err),
      })
    }

    recategorizeAll(user).catch((err) => {
      auditError(user, 'data', 'Recategorization after move failed', { error: String(err) })
    })
  }

  return result
}

// ============================================================================
// Import from ActivityWatch
// ============================================================================

/**
 * Convert ActivityWatch categories to our format.
 */
export const convertAwCategories = (awCategories: AwCategory[]): CreateScreentimeCategoryBody[] =>
  awCategories
    .filter((c) => {
      // Skip the "Uncategorized" meta-category
      return !(c.name.length === 1 && c.name[0] === 'Uncategorized')
    })
    .map((c, i) => ({
      color: c.data?.color || undefined,
      ignore_case: c.rule?.ignore_case ?? true,
      name: c.name,
      rule_regex: c.rule?.type === 'regex' ? c.rule.regex : undefined,
      rule_type: c.rule?.type === 'regex' ? ('regex' as const) : ('none' as const),
      score: c.data?.score != null ? c.data.score : undefined,
      sort_order: i,
    }))

/**
 * Import categories from ActivityWatch, optionally replacing existing ones.
 */
export const importFromActivityWatch = async (
  user: string,
  awCategories: AwCategory[],
  replace: boolean,
): Promise<ScreentimeCategory[]> => {
  const converted = convertAwCategories(awCategories)

  if (replace) {
    await deleteAllScreentimeCategories(user)
  }

  const result = await bulkInsertScreentimeCategories(
    user,
    converted.map((c) => ({
      color: c.color,
      ignore_case: c.ignore_case ?? true,
      name: c.name,
      rule_regex: c.rule_regex,
      rule_type: c.rule_type ?? 'none',
      score: c.score,
      sort_order: c.sort_order,
    })),
  )

  // Mirror all freshly-inserted categories into activity types in depth order.
  try {
    await ensureAllCategoriesHaveTypes(user, result)
  } catch (err) {
    console.error('⚠️ Failed to mirror imported categories to activity types:', err)
    auditError(user, 'data', 'Failed to mirror imported categories to activity types', {
      error: String(err),
    })
  }

  // Fire-and-forget recategorization
  recategorizeAll(user).catch((err) => {
    auditError(user, 'data', 'Recategorization after AW import failed', { error: String(err) })
  })

  return result
}

/**
 * Fetch categories from an ActivityWatch server via its settings API.
 */
export const fetchAwCategories = async (serverUrl: string): Promise<AwCategory[]> => {
  const url = `${serverUrl.replace(/\/+$/, '')}/api/0/settings`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to fetch ActivityWatch settings: ${response.status} ${response.statusText}`)
  }

  const settings = (await response.json()) as Record<string, unknown>
  const classes = settings.classes as AwCategory[] | undefined

  if (!classes || !Array.isArray(classes)) {
    throw new Error('No categories found in ActivityWatch settings')
  }

  return classes
}
