import type { RunCategory } from '@aurboda/api-spec'

type Data = Record<string, unknown> | undefined

export interface RunCategoryChanges {
  run_categories: RunCategory[]
  run_categories_excluded: string[]
}

const isRunCategory = (value: unknown): value is RunCategory =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { category?: unknown }).category === 'string' &&
  Array.isArray((value as { reasons?: unknown }).reasons)

export const runCategories = (data: Data): RunCategory[] =>
  Array.isArray(data?.run_categories) ? data.run_categories.filter(isRunCategory) : []

export const excludedRunCategories = (data: Data): string[] =>
  Array.isArray(data?.run_categories_excluded)
    ? data.run_categories_excluded.filter((c): c is string => typeof c === 'string')
    : []

export const RUN_CATEGORY_NAME = /^[a-z][a-z0-9_]*$/

/** Lower-cases and snake_cases free text; null when nothing usable is left. */
export const normalizeCategoryName = (input: string): string | null => {
  const name = input
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
  return RUN_CATEGORY_NAME.test(name) ? name : null
}

/** A rule-set category is also excluded, so the rule does not put it back; a hand-set one just goes. */
export const removeCategory = (data: Data, category: string): RunCategoryChanges => {
  const current = runCategories(data)
  const removed = current.find((c) => c.category === category)
  const excluded = excludedRunCategories(data)
  return {
    run_categories: current.filter((c) => c.category !== category),
    run_categories_excluded:
      removed?.rule_id && !excluded.includes(category) ? [...excluded, category] : excluded,
  }
}

export const addCategory = (data: Data, category: string): RunCategoryChanges => {
  const current = runCategories(data)
  return {
    run_categories: current.some((c) => c.category === category)
      ? current
      : [...current, { category, reasons: ['added by hand'] }],
    run_categories_excluded: excludedRunCategories(data).filter((c) => c !== category),
  }
}

/** True for `running` and the types below it in the hierarchy. */
export const isRunType = (
  name: string,
  definitions: { name: string; parent_type?: string | null }[] | undefined,
): boolean => {
  const parents = new Map((definitions ?? []).map((d) => [d.name, d.parent_type ?? undefined]))
  const seen = new Set<string>()
  for (
    let current: string | undefined = name;
    current && !seen.has(current);
    current = parents.get(current)
  ) {
    if (current === 'running') return true
    seen.add(current)
  }
  return false
}
