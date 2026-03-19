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
  updateScreentimeCategory,
  upsertScreentimeCategory,
} from '../db/index.ts'

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

  // Fire-and-forget recategorization (only if the new category has a rule)
  if (input.rule_type === 'regex' && input.rule_regex) {
    recategorizeAll(user).catch((err) => {
      console.error(`Recategorization failed for user ${user}:`, err)
    })
  }

  return result
}

export const modifyCategory = async (user: string, id: string, input: Partial<ScreentimeCategoryInput>) => {
  const result = await updateScreentimeCategory(user, id, input)

  // Recategorize if rules or name changed (any of these affect resolution)
  if (
    input.rule_type !== undefined ||
    input.rule_regex !== undefined ||
    input.ignore_case !== undefined ||
    input.name !== undefined
  ) {
    recategorizeAll(user).catch((err) => {
      console.error(`Recategorization failed for user ${user}:`, err)
    })
  }

  return result
}

export const removeCategory = async (user: string, id: string) => {
  const count = await deleteScreentimeCategoryWithChildren(user, id)

  if (count > 0) {
    recategorizeAll(user).catch((err) => {
      console.error(`Recategorization failed for user ${user}:`, err)
    })
  }

  return count
}

export const getCategoryById = async (user: string, id: string) => getScreentimeCategoryById(user, id)

export const upsertCategory = async (user: string, id: string, input: ScreentimeCategoryInput) => {
  const result = await upsertScreentimeCategory(user, id, input)

  // Recategorize if the category has a rule
  if (input.rule_type === 'regex' && input.rule_regex) {
    recategorizeAll(user).catch((err) => {
      console.error(`Recategorization failed for user ${user}:`, err)
    })
  }

  return result
}

export const moveCategoryToParent = async (user: string, id: string, newParentId: string | null) => {
  // Resolve the new parent's name path
  let newParentName: string[] | null = null
  if (newParentId) {
    const parent = await getScreentimeCategoryById(user, newParentId)
    if (!parent) throw new Error('Parent category not found')
    newParentName = parent.name
  }

  const result = await moveScreentimeCategory(user, id, newParentName)

  if (result.updated > 0) {
    recategorizeAll(user).catch((err) => {
      console.error(`Recategorization after move failed for user ${user}:`, err)
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

  // Fire-and-forget recategorization
  recategorizeAll(user).catch((err) => {
    console.error(`Recategorization after AW import failed for user ${user}:`, err)
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
