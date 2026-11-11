import type { ActivityFieldValue } from '@aurboda/api-spec'

const normalise = (text: string): string => text.trim().toLowerCase()

export const filterKnownValues = (values: ActivityFieldValue[], typed: string): ActivityFieldValue[] => {
  const needle = normalise(typed)
  if (needle === '' || values.some((v) => v.value.toLowerCase() === needle)) return values
  return values.filter((v) => v.value.toLowerCase().includes(needle))
}

export const exactMatchIndex = (suggestions: ActivityFieldValue[], typed: string): number => {
  const needle = normalise(typed)
  return needle === '' ? -1 : suggestions.findIndex((v) => v.value.toLowerCase() === needle)
}

export const stepActiveIndex = (current: number, delta: number, count: number): number =>
  count === 0 ? -1 : Math.min(count - 1, Math.max(0, current + delta))
