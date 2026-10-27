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

export interface RunCategoryGroup {
  category: string
  reasons: string[]
  /** Set by at least one rule (removing it then also excludes it). */
  from_rule: boolean
}

/** One entry per category name: a manual and a rule entry (or two rules) of the same name show as one chip. */
export const groupedRunCategories = (data: Data): RunCategoryGroup[] => {
  const groups = new Map<string, RunCategoryGroup>()
  for (const entry of runCategories(data)) {
    const group = groups.get(entry.category) ?? { category: entry.category, from_rule: false, reasons: [] }
    for (const reason of entry.reasons) if (!group.reasons.includes(reason)) group.reasons.push(reason)
    group.from_rule ||= Boolean(entry.rule_id)
    groups.set(entry.category, group)
  }
  return [...groups.values()]
}

/** Every entry of the category goes; when any came from a rule it is also excluded, so no rule puts it back. */
export const removeCategory = (data: Data, category: string): RunCategoryChanges => {
  const current = runCategories(data)
  const fromRule = current.some((c) => c.category === category && c.rule_id)
  const excluded = excludedRunCategories(data)
  return {
    run_categories: current.filter((c) => c.category !== category),
    run_categories_excluded: fromRule && !excluded.includes(category) ? [...excluded, category] : excluded,
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
