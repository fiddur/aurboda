import type { ActivityFieldValue } from '@aurboda/api-spec'

export const filterKnownValues = (values: ActivityFieldValue[], typed: string): ActivityFieldValue[] => {
  const needle = typed.trim().toLowerCase()
  if (needle === '' || values.some((v) => v.value.toLowerCase() === needle)) return values
  return values.filter((v) => v.value.toLowerCase().includes(needle))
}

export const stepActiveIndex = (current: number, delta: number, count: number): number =>
  count === 0 ? -1 : Math.min(count - 1, Math.max(0, current + delta))
