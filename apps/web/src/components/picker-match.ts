import { foldedIncludes, searchFold } from '../utils/searchFold'

const toSnakeCase = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_|_$/g, '')
    .replaceAll(/_+/g, '_') || ''

interface NamedType {
  name: string
  display_name: string
}

export interface ActivityTypeMatch<T extends NamedType> {
  filtered: T[]
  isNewType: boolean
  snakeInput: string
}

export const matchActivityTypes = <T extends NamedType>(
  defs: T[],
  input: string,
  isLoading = false,
): ActivityTypeMatch<T> => {
  const query = input.trim().toLowerCase()
  const snakeInput = toSnakeCase(query)
  if (!query) return { filtered: defs, isNewType: false, snakeInput }

  const isExact = (d: T) =>
    d.display_name.toLowerCase() === query || d.name === query || d.name === snakeInput
  const folded = searchFold(query)
  const matching = defs.filter(
    (d) => foldedIncludes(d.display_name, folded) || foldedIncludes(d.name, folded),
  )
  const exact = defs.filter(isExact)
  const filtered = [...exact, ...matching.filter((d) => !isExact(d))]
  const isNewType = !isLoading && snakeInput.length > 0 && exact.length === 0
  return { filtered, isNewType, snakeInput }
}

export const matchMetricEntries = <T extends { keywords?: string[]; label: string; value: string }>(
  entries: T[],
  input: string,
): T[] => {
  const query = searchFold(input.trim())
  return entries.filter(
    (entry) =>
      foldedIncludes(entry.label, query) ||
      foldedIncludes(entry.value, query) ||
      foldedIncludes(entry.value.replaceAll('_', ' '), query) ||
      (entry.keywords ?? []).some((keyword) => foldedIncludes(keyword, query)),
  )
}
