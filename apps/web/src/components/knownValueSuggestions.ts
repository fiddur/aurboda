import type { ExerciseCatalogEntry } from '@aurboda/api-spec'

export interface Suggestion {
  value: string
  count?: number
  hint?: string
}

const normalise = (text: string): string => text.trim().toLowerCase()

const nameKey = (text: string): string =>
  text
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

export const filterKnownValues = <T extends Suggestion>(values: T[], typed: string): T[] => {
  const needle = normalise(typed)
  if (needle === '' || values.some((v) => v.value.toLowerCase() === needle)) return values
  return values.filter((v) => v.value.toLowerCase().includes(needle))
}

export const exactMatchIndex = (suggestions: Suggestion[], typed: string): number => {
  const needle = normalise(typed)
  return needle === '' ? -1 : suggestions.findIndex((v) => v.value.toLowerCase() === needle)
}

export const stepActiveIndex = (current: number, delta: number, count: number): number =>
  count === 0 ? -1 : Math.min(count - 1, Math.max(0, current + delta))

export const catalogHint = (entry: ExerciseCatalogEntry): string | undefined => {
  const full = entry.muscles.filter((m) => m.weight === 1)
  if (full.length > 0) {
    return full
      .slice(0, 2)
      .map((m) => m.name)
      .join(', ')
  }
  const strongest = entry.muscles.reduce<ExerciseCatalogEntry['muscles'][number] | undefined>(
    (best, m) => (best === undefined || m.weight > best.weight ? m : best),
    undefined,
  )
  return strongest?.name
}

export const mergeSuggestions = (own: Suggestion[], catalogEntries: ExerciseCatalogEntry[]): Suggestion[] => {
  const ownKeys = new Set(own.map((s) => nameKey(s.value)))
  return [
    ...own,
    ...catalogEntries
      .filter((entry) => !ownKeys.has(nameKey(entry.name)))
      .map((entry) => ({ hint: catalogHint(entry), value: entry.name })),
  ]
}

export const isSameName = (a: string, b: string): boolean => nameKey(a) === nameKey(b)
