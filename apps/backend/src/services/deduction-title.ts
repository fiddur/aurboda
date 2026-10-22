import { prettifyKey } from './activitypub/object.ts'

export interface TitledActivity {
  data?: Record<string, unknown> | null
  title?: string | null
}

export interface RuleTitleChange {
  data: { _titled_by: string; _titled_value: string }
  title: string
}

/** The titles a synced activity carries when nobody named it: its type's display name and prettified key. */
export const activityTypeTitleNames = (key: string, displayName?: string | null): string[] =>
  [displayName, prettifyKey(key)].filter((name): name is string => Boolean(name?.trim()))

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * The title an enrich rule with `output_title_field` writes, or null to leave the activity alone.
 * The rule only replaces a title nobody chose: a blank one, the type's name, or the value it
 * wrote itself last time (`_titled_by` / `_titled_value`), so a title typed by hand survives.
 */
export const ruleTitleChange = (
  activity: TitledActivity,
  field: string,
  ruleId: string,
  typeNames: string[],
): RuleTitleChange | null => {
  const data = activity.data ?? {}
  const raw = data[field]
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value) return null

  const current = (activity.title ?? '').trim()
  if (current === value) return null

  const ownedByRule =
    data._titled_by === ruleId && typeof data._titled_value === 'string' && data._titled_value === current
  const replaceable = !current || typeNames.some((name) => sameName(name, current)) || ownedByRule
  if (!replaceable) return null

  return { data: { _titled_by: ruleId, _titled_value: value }, title: value }
}
