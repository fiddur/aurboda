import type { CorrelationSelector, CorrelationSelectorsData, TriggerCondition } from '@aurboda/api-spec'

/** "at least N minutes" as a whole number above 0, or null when blank or not one. */
export const parseMinMinutes = (raw: string): number | null => {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const minutes = Number(trimmed)
  return minutes > 0 ? minutes : null
}

/** The Event-mode trigger the picker's selector stands for. */
export const toTriggerCondition = (trigger: CorrelationSelector, minMinutes: string): TriggerCondition => {
  switch (trigger.kind) {
    case 'nutrition':
      return { nutrient: trigger.nutrient, type: 'nutrition' }
    case 'people': {
      const minutes = parseMinMinutes(minMinutes)
      return {
        type: 'people',
        ...(trigger.person_id ? { person_id: trigger.person_id } : {}),
        ...(minutes ? { threshold: { op: 'gte', value: minutes } } : {}),
      }
    }
    case 'metric':
    case 'sensitivity':
      return { pattern: '', type: 'activity' }
    default:
      return { pattern: trigger.pattern, type: trigger.kind }
  }
}

/** What the trigger is called above an Event-mode result. */
export const eventTriggerLabel = (
  trigger: CorrelationSelector,
  selectors: Pick<CorrelationSelectorsData, 'people'> | undefined,
  minMinutes: string,
): string => {
  switch (trigger.kind) {
    case 'people': {
      const name = trigger.person_id
        ? (selectors?.people.find((p) => p.value === trigger.person_id)?.label ?? 'a person no longer listed')
        : 'anyone'
      const minutes = parseMinMinutes(minMinutes)
      return `Time with ${name}${minutes ? ` (at least ${minutes} min)` : ''}`
    }
    case 'nutrition':
      return trigger.nutrient
    case 'metric':
      return trigger.metric
    case 'sensitivity':
      return trigger.flag
    default:
      return trigger.pattern
  }
}
