import {
  type ExerciseCatalogEntry,
  type ExerciseCatalogQuery,
  type ExerciseCatalogSearchResult,
  type ExerciseMuscle,
  exerciseEquipmentInfo,
  exerciseMuscleInfo,
  type StoredExerciseCatalog,
  type StoredExerciseCatalogEntry,
} from '@aurboda/api-spec'
import { readFileSync } from 'node:fs'

export const normalizeExerciseName = (name: string): string =>
  name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .trim()

let loaded: StoredExerciseCatalog | undefined

/** The built-in catalogue, read once on first use. Its shape is checked by the catalogue tests, not here. */
export const loadExerciseCatalog = (): StoredExerciseCatalog => {
  loaded ??= JSON.parse(
    readFileSync(new URL('../catalog/exercises/exercise-catalog.json', import.meta.url), 'utf8'),
  ) as StoredExerciseCatalog
  return loaded
}

interface CatalogIndex {
  byKey: Map<string, StoredExerciseCatalogEntry>
  byName: Map<string, StoredExerciseCatalogEntry>
  words: Map<
    StoredExerciseCatalogEntry,
    { all: string[]; labels: string[][]; name: string[]; terms: string[] }
  >
}

const indexes = new WeakMap<StoredExerciseCatalog, CatalogIndex>()

const words = (text: string): string[] => normalizeExerciseName(text).split(' ').filter(Boolean)

const indexOf = (catalog: StoredExerciseCatalog): CatalogIndex => {
  const cached = indexes.get(catalog)
  if (cached) return cached
  const index: CatalogIndex = { byKey: new Map(), byName: new Map(), words: new Map() }
  for (const entry of catalog.entries) {
    index.byKey.set(entry.key, entry)
    for (const label of [entry.name, ...entry.aliases]) index.byName.set(normalizeExerciseName(label), entry)
    index.words.set(entry, {
      all: [...new Set([entry.name, ...entry.aliases, ...entry.search_terms].flatMap(words))],
      labels: [entry.name, ...entry.aliases].map((label) => [...new Set(words(label))]),
      name: words(entry.name),
      terms: [...new Set(entry.search_terms.flatMap(words))],
    })
  }
  indexes.set(catalog, index)
  return index
}

export const getExerciseByKey = (
  catalog: StoredExerciseCatalog,
  key: string,
): StoredExerciseCatalogEntry | undefined => indexOf(catalog).byKey.get(key)

export const findExerciseByName = (
  catalog: StoredExerciseCatalog,
  name: string,
): StoredExerciseCatalogEntry | undefined => indexOf(catalog).byName.get(normalizeExerciseName(name))

const worksMuscle = (entry: StoredExerciseCatalogEntry, muscle: ExerciseMuscle): boolean =>
  (Object.entries(entry.muscles) as [ExerciseMuscle, number][]).some(
    ([key, weight]) => weight >= 0.5 && (key === muscle || exerciseMuscleInfo[key].group === muscle),
  )

/** The query schema's output, with `limit` and `offset` defaulted here when left out. */
export type ExerciseSearch = Omit<ExerciseCatalogQuery, 'limit' | 'offset'> &
  Partial<Pick<ExerciseCatalogQuery, 'limit' | 'offset'>>

const matchesFilters = (entry: StoredExerciseCatalogEntry, query: ExerciseSearch): boolean =>
  (!query.equipment || entry.equipment.includes(query.equipment)) &&
  (!query.category || entry.category === query.category) &&
  (!query.muscle || worksMuscle(entry, query.muscle))

const byName = (a: StoredExerciseCatalogEntry, b: StoredExerciseCatalogEntry): number =>
  a.name.length - b.name.length || a.name.localeCompare(b.name, 'en')

/** Exact match, then matches in the name, then matches through aliases and search terms. */
const tier = (rank: number): number => (rank === 0 ? 0 : rank <= 2 ? 1 : 2)

/** body.build's hand-picked gym exercises go before the long tail of free-exercise-db within a tier. */
const curatedFirst = (entry: StoredExerciseCatalogEntry): number =>
  entry.same_as.bodybuild === undefined ? 1 : 0

const rankSearch = (catalog: StoredExerciseCatalog, q: string, candidates: StoredExerciseCatalogEntry[]) => {
  const index = indexOf(catalog)
  const normalized = normalizeExerciseName(q)
  const queryWords = words(q)
  const isPrefixOfAny = (pool: string[]) => (word: string) => pool.some((w) => w.startsWith(word))
  const rank = (entry: StoredExerciseCatalogEntry): number => {
    const entryWords = index.words.get(entry) ?? { all: [], labels: [], name: [], terms: [] }
    if (!queryWords.every(isPrefixOfAny(entryWords.all))) return -1
    if (index.byName.get(normalized) === entry) return 0
    if (normalizeExerciseName(entry.name).startsWith(normalized)) return 1
    if (queryWords.every(isPrefixOfAny(entryWords.name))) return 2
    return 3
  }
  return candidates
    .map((entry) => ({ entry, rank: rank(entry) }))
    .filter(({ rank: r }) => r >= 0)
    .sort(
      (a, b) =>
        tier(a.rank) - tier(b.rank) ||
        curatedFirst(a.entry) - curatedFirst(b.entry) ||
        a.rank - b.rank ||
        byName(a.entry, b.entry),
    )
    .map(({ entry }) => entry)
}

export const toExerciseCatalogEntry = (entry: StoredExerciseCatalogEntry): ExerciseCatalogEntry => ({
  aliases: entry.aliases,
  category: entry.category,
  equipment: entry.equipment.map((key) => ({ key, ...exerciseEquipmentInfo[key] })),
  key: entry.key,
  muscles: (Object.entries(entry.muscles) as [ExerciseMuscle, number][])
    .map(([key, weight]) => ({ key, ...exerciseMuscleInfo[key], weight }))
    .sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  name: entry.name,
  same_as: entry.same_as,
})

export const searchExercises = (
  catalog: StoredExerciseCatalog,
  query: ExerciseSearch,
): ExerciseCatalogSearchResult => {
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 100)
  const offset = Math.max(query.offset ?? 0, 0)
  const exact = query.name === undefined ? undefined : findExerciseByName(catalog, query.name)
  const pool = query.name === undefined ? catalog.entries : exact ? [exact] : []
  const filtered = pool.filter((entry) => matchesFilters(entry, query))
  const q = query.name === undefined ? query.q?.trim() : undefined
  const ordered = q
    ? rankSearch(catalog, q, filtered)
    : [...filtered].sort((a, b) => a.name.localeCompare(b.name, 'en'))
  return {
    entries: ordered.slice(offset, offset + limit).map(toExerciseCatalogEntry),
    total: ordered.length,
    version: catalog.version,
  }
}

const wordsMeet = (a: string, b: string): boolean => {
  if (a === b) return true
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  return shorter.length >= 3 && longer.startsWith(shorter)
}

const meetsAny = (pool: string[]) => (word: string) => pool.some((w) => wordsMeet(word, w))

const SUGGESTION_THRESHOLD = 0.34

/**
 * Jaccard overlap of the name's words with the entry's best-matching name or alias, where a word
 * also meets its prefix of three or more letters (`curl` meets `curls`), and a word found only in
 * the search terms counts half.
 */
const suggestionScore = (nameWords: string[], labels: string[][], terms: string[]): number =>
  Math.max(
    0,
    ...labels.map((label) => {
      const inLabel = nameWords.filter(meetsAny(label)).length
      const inTermsOnly = nameWords.filter((w) => !meetsAny(label)(w) && meetsAny(terms)(w)).length
      return (inLabel + inTermsOnly / 2) / (nameWords.length + label.length - inLabel)
    }),
  )

/** Catalogue entries a logged name may stand for, best first. */
export const suggestExercises = (
  catalog: StoredExerciseCatalog,
  name: string,
  limit = 3,
): StoredExerciseCatalogEntry[] => {
  const nameWords = [...new Set(words(name))]
  if (nameWords.length === 0) return []
  const index = indexOf(catalog)
  return catalog.entries
    .map((entry) => {
      const entryWords = index.words.get(entry)
      return {
        entry,
        score: entryWords ? suggestionScore(nameWords, entryWords.labels, entryWords.terms) : 0,
      }
    })
    .filter(({ score }) => score >= SUGGESTION_THRESHOLD)
    .sort((a, b) => b.score - a.score || byName(a.entry, b.entry))
    .slice(0, limit)
    .map(({ entry }) => entry)
}
