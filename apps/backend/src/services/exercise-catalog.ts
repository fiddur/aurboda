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

interface EntryWords {
  all: Set<string>
  labelKeys: string[]
  labels: string[][]
  name: Set<string>
  nameKey: string
  terms: string[]
}

interface CatalogIndex {
  byFit: Map<string, StoredExerciseCatalogEntry>
  byKey: Map<string, StoredExerciseCatalogEntry>
  byName: Map<string, StoredExerciseCatalogEntry>
  words: Map<StoredExerciseCatalogEntry, EntryWords>
}

const indexes = new WeakMap<StoredExerciseCatalog, CatalogIndex>()

const words = (text: string): string[] => normalizeExerciseName(text).split(' ').filter(Boolean)

const SYNONYM_GROUPS = [
  ['dumbbell', 'db'],
  ['barbell', 'bb'],
  ['kettlebell', 'kb'],
  ['one', 'single'],
  ['fly', 'flye'],
]

const synonymGroups = new Map(SYNONYM_GROUPS.flatMap((group) => group.map((word) => [word, group] as const)))

const singular = (word: string): string => {
  if (word.length < 3 || !word.endsWith('s') || word.endsWith('ss')) return word
  return word.endsWith('ies') ? `${word.slice(0, -3)}y` : word.slice(0, -1)
}

/** The forms a query word may stand for besides itself: `crunches` is `crunche` or `crunch`. */
const singulars = (word: string): string[] => {
  const one = singular(word)
  if (one === word) return []
  return word.endsWith('es') && !word.endsWith('ies') ? [one, word.slice(0, -2)] : [one]
}

const canonical = (word: string): string => {
  const one = singular(word)
  return synonymGroups.get(one)?.[0] ?? one
}

const synonymsOf = (word: string): string[] =>
  (synonymGroups.get(canonical(word)) ?? []).filter((synonym) => synonym !== word)

const canonicalWords = (text: string): string[] => words(text).map(canonical)

const uniqueCanonicalWords = (text: string): string[] => [...new Set(canonicalWords(text))]

const canonicalKey = (text: string): string => canonicalWords(text).join('')

/** Each word, its synonyms, and each pair of adjacent words written together (`pull up` gives `pullup`). */
const poolOf = (texts: string[]): Set<string> => {
  const pool = new Set<string>()
  for (const text of texts) {
    const textWords = words(text)
    textWords.forEach((word, i) => {
      pool.add(word)
      for (const synonym of synonymsOf(word)) pool.add(synonym)
      if (i > 0) pool.add(`${textWords[i - 1]}${word}`)
    })
  }
  return pool
}

const entryWordsOf = (entry: StoredExerciseCatalogEntry): EntryWords => {
  const labels = [entry.name, ...entry.aliases]
  return {
    all: poolOf([...labels, ...entry.search_terms]),
    labelKeys: labels.map(canonicalKey),
    labels: labels.map(uniqueCanonicalWords),
    name: poolOf([entry.name]),
    nameKey: canonicalKey(entry.name),
    terms: [...new Set(entry.search_terms.flatMap(canonicalWords))],
  }
}

const indexOf = (catalog: StoredExerciseCatalog): CatalogIndex => {
  const cached = indexes.get(catalog)
  if (cached) return cached
  const index: CatalogIndex = { byFit: new Map(), byKey: new Map(), byName: new Map(), words: new Map() }
  for (const entry of catalog.entries) {
    index.byKey.set(entry.key, entry)
    for (const fit of entry.same_as.fit ?? []) index.byFit.set(fit, entry)
    for (const label of [entry.name, ...entry.aliases]) index.byName.set(normalizeExerciseName(label), entry)
    index.words.set(entry, entryWordsOf(entry))
  }
  indexes.set(catalog, index)
  return index
}

const NO_WORDS: EntryWords = {
  all: new Set(),
  labelKeys: [],
  labels: [],
  name: new Set(),
  nameKey: '',
  terms: [],
}

const wordsOf = (catalog: StoredExerciseCatalog, entry: StoredExerciseCatalogEntry): EntryWords =>
  indexOf(catalog).words.get(entry) ?? NO_WORDS

export const getExerciseByKey = (
  catalog: StoredExerciseCatalog,
  key: string,
): StoredExerciseCatalogEntry | undefined => indexOf(catalog).byKey.get(key)

export const findExerciseByName = (
  catalog: StoredExerciseCatalog,
  name: string,
): StoredExerciseCatalogEntry | undefined => indexOf(catalog).byName.get(normalizeExerciseName(name))

export const findExerciseByFit = (
  catalog: StoredExerciseCatalog,
  fit: string,
): StoredExerciseCatalogEntry | undefined => indexOf(catalog).byFit.get(fit.trim().toLowerCase())

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

const tier = (rank: number): number => (rank <= 1 ? 0 : rank <= 3 ? 1 : 2)

const implementWords = (entry: StoredExerciseCatalogEntry): Set<string> =>
  new Set(
    entry.equipment
      .filter((key) => exerciseEquipmentInfo[key].category === 'free_weights')
      .flatMap((key) => canonicalWords(exerciseEquipmentInfo[key].name)),
  )

/** Within a tier: body.build's hand-picked gym exercises, then free-exercise-db, then Garmin-only entries. */
const curatedFirst = ({ same_as }: StoredExerciseCatalogEntry): number =>
  same_as.bodybuild !== undefined ? 0 : same_as.free_exercise_db !== undefined ? 1 : 2

const startsAnyIn = (pool: Set<string>, word: string): boolean => {
  for (const poolWord of pool) if (poolWord.startsWith(word)) return true
  return false
}

/** A plural meets its singular exactly, not as a prefix: `abs` meets `ab` but not `abduction`. */
const meets =
  (pool: Set<string>) =>
  (word: string): boolean =>
    startsAnyIn(pool, word) || singulars(word).some((form) => pool.has(form))

/** The query as typed, and with each pair of adjacent words written together (`dead lift` as `deadlift`). */
const queryAlternatives = (queryWords: string[]): string[][] => [
  queryWords,
  ...queryWords
    .slice(1)
    .map((word, i) => [...queryWords.slice(0, i), `${queryWords[i]}${word}`, ...queryWords.slice(i + 2)]),
]

interface QueryMatcher {
  canonicalWords: string[]
  key: string
  matchesPool: (pool: Set<string>) => boolean
}

const queryMatcher = (q: string): QueryMatcher => {
  const queryWords = words(q)
  const alternatives = queryAlternatives(queryWords)
  const queryCanonical = queryWords.map(canonical)
  return {
    canonicalWords: queryCanonical,
    key: queryCanonical.join(''),
    matchesPool: (pool) => alternatives.some((alternative) => alternative.every(meets(pool))),
  }
}

/** "Barbell Squat" for "squat": the query plus only the words of the entry's own free weight, so the canonical lift ranks with an exact match. */
const isImplementVariant =
  (queryCanonical: string[], implement: Set<string>) =>
  (label: string[]): boolean => {
    const extra = label.filter((word) => !queryCanonical.includes(word))
    return (
      extra.length > 0 &&
      extra.length < label.length &&
      queryCanonical.every((word) => label.includes(word)) &&
      extra.every((word) => implement.has(word))
    )
  }

const rankEntry = (
  matcher: QueryMatcher,
  entry: StoredExerciseCatalogEntry,
  entryWords: EntryWords,
): number => {
  if (!matcher.matchesPool(entryWords.all)) return -1
  if (entryWords.labelKeys.includes(matcher.key)) return 0
  if (entryWords.labels.some(isImplementVariant(matcher.canonicalWords, implementWords(entry)))) return 1
  if (entryWords.nameKey.startsWith(matcher.key)) return 2
  if (matcher.matchesPool(entryWords.name)) return 3
  return 4
}

type Closeness = (entry: StoredExerciseCatalogEntry) => number

const rankSearch = (
  catalog: StoredExerciseCatalog,
  q: string,
  candidates: StoredExerciseCatalogEntry[],
  closeness?: Closeness,
) => {
  const matcher = queryMatcher(q)
  return candidates
    .map((entry) => ({ entry, rank: rankEntry(matcher, entry, wordsOf(catalog, entry)) }))
    .filter(({ rank }) => rank >= 0)
    .map((ranked) => ({ ...ranked, close: closeness ? closeness(ranked.entry) : 0 }))
    .sort(
      (a, b) =>
        tier(a.rank) - tier(b.rank) ||
        b.close - a.close ||
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

const closenessTo = (catalog: StoredExerciseCatalog, name: string): Closeness => {
  const nameWords = uniqueCanonicalWords(name)
  return (entry) => {
    if (nameWords.length === 0) return 0
    const { labels, terms } = wordsOf(catalog, entry)
    return suggestionScore(nameWords, labels, terms)
  }
}

const closest = (entries: StoredExerciseCatalogEntry[], closeness: Closeness): StoredExerciseCatalogEntry[] =>
  entries
    .map((entry) => ({ entry, score: closeness(entry) }))
    .filter(({ score }) => score >= SUGGESTION_THRESHOLD)
    .sort((a, b) => b.score - a.score || byName(a.entry, b.entry))
    .map(({ entry }) => entry)

const orderSearch = (
  catalog: StoredExerciseCatalog,
  filtered: StoredExerciseCatalogEntry[],
  q: string | undefined,
  similar: string | undefined,
): StoredExerciseCatalogEntry[] => {
  const closeness = similar ? closenessTo(catalog, similar) : undefined
  if (q) return rankSearch(catalog, q, filtered, closeness)
  if (closeness) return closest(filtered, closeness)
  return [...filtered].sort((a, b) => a.name.localeCompare(b.name, 'en'))
}

export const searchExercises = (
  catalog: StoredExerciseCatalog,
  query: ExerciseSearch,
): ExerciseCatalogSearchResult => {
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 100)
  const offset = Math.max(query.offset ?? 0, 0)
  const exact = [
    ...(query.name === undefined ? [] : [findExerciseByName(catalog, query.name)]),
    ...(query.fit === undefined ? [] : [findExerciseByFit(catalog, query.fit)]),
  ]
  const isExact = exact.length > 0
  const pool = !isExact
    ? catalog.entries
    : exact.every((entry) => entry !== undefined && entry === exact[0])
      ? [exact[0] as StoredExerciseCatalogEntry]
      : []
  const filtered = pool.filter((entry) => matchesFilters(entry, query))
  const ordered = isExact
    ? filtered
    : orderSearch(catalog, filtered, query.q?.trim(), query.similar_to?.trim() || undefined)
  return {
    entries: ordered.slice(offset, offset + limit).map(toExerciseCatalogEntry),
    total: ordered.length,
    version: catalog.version,
  }
}

/** Catalogue entries a logged name may stand for, best first. */
export const suggestExercises = (
  catalog: StoredExerciseCatalog,
  name: string,
  limit = 3,
): StoredExerciseCatalogEntry[] => closest(catalog.entries, closenessTo(catalog, name)).slice(0, limit)
