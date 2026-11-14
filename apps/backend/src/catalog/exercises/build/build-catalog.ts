import {
  exerciseCategories,
  type ExerciseCatalogSameAs,
  type ExerciseCategory,
  type ExerciseEquipment,
  type ExerciseMuscle,
  exerciseEquipment,
  exerciseMuscles,
  type StoredExerciseCatalog,
  type StoredExerciseCatalogEntry,
} from '@aurboda/api-spec'
import { readFileSync, writeFileSync } from 'node:fs'

import type { BodybuildExercise, BodybuildSourceFile } from './convert-bodybuild.ts'
import type { FreeExercise, FreeExerciseSourceFile } from './trim-free-exercise-db.ts'
import type { GarminSourceFile } from './trim-garmin.ts'

import { normalizeExerciseName } from '../../../services/exercise-catalog.ts'
import { formatJson } from './json.ts'

export interface CatalogLinks {
  aliases: Record<string, string[]>
  /** Catalogue key → equipment that replaces the built entry's. */
  equipment: Record<string, string[]>
  links: Record<string, string>
  name_overrides: Record<string, string>
  version: string
  wikidata: Record<string, string>
}

export interface GarminLinks {
  entries: Record<
    string,
    { category: ExerciseCategory; equipment: string[]; muscles: Record<string, number> }
  >
  /** FIT key → catalogue key of the body.build or free-exercise-db entry that is the same exercise. */
  links: Record<string, string>
  name_overrides: Record<string, string>
  /** FIT key → FIT key of the exercise whose entry it shares. */
  variants: Record<string, string>
}

const UPPER_TOKENS = new Set(['bsq', 'ez', 'rdl', 'trx'])
const MINOR_WORDS = new Set(['and', 'of', 'on', 'the', 'to', 'with'])
const SPELLING_FIXES: Record<string, string> = { smitch: 'smith' }

const capitalise = (segment: string, lowerIfMinor: boolean): string => {
  const [, open = '', word = ''] = /^(\(*)(.*)$/.exec(segment) ?? []
  const lower = word.toLowerCase()
  if (UPPER_TOKENS.has(lower)) return open + word.toUpperCase()
  if (lowerIfMinor && MINOR_WORDS.has(lower)) return open + lower
  return open + word.charAt(0).toUpperCase() + word.slice(1)
}

/** body.build ids are lowercase phrases; this is their display name. */
export const bodybuildDisplayName = (id: string): string =>
  id
    .split(' ')
    .map((word, i) =>
      (SPELLING_FIXES[word] ?? word)
        .split('-')
        .map((segment, j) => capitalise(segment, i > 0 && j === 0 && !word.includes('-')))
        .join('-'),
    )
    .join(' ')

export const deriveKey = (name: string): string => {
  const slug = name
    .normalize('NFD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll('°', '')
    .replaceAll('&', ' and ')
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
  const tokens = slug.split('_')
  const leading = tokens.findIndex((token) => !/^[0-9]+$/.test(token))
  const key = leading > 0 ? [...tokens.slice(leading), ...tokens.slice(0, leading)].join('_') : slug
  if (!/^[a-z][a-z0-9_]*$/.test(key)) throw new Error(`Cannot derive a key from '${name}' (got '${key}')`)
  return key
}

const sortMuscles = (
  muscles: Partial<Record<ExerciseMuscle, number>>,
): Partial<Record<ExerciseMuscle, number>> =>
  Object.fromEntries(
    (Object.entries(muscles) as [ExerciseMuscle, number][]).sort(([ka, wa], [kb, wb]) =>
      wa === wb ? (ka < kb ? -1 : 1) : wb - wa,
    ),
  )

const unique = (values: string[]): string[] => [...new Set(values)]

interface Draft {
  bodybuild?: BodybuildExercise
  free?: FreeExercise
}

const draftName = ({ bodybuild, free }: Draft, links: CatalogLinks): string => {
  const defaultName = bodybuild ? bodybuildDisplayName(bodybuild.id) : (free?.name ?? '')
  const sourceRef = bodybuild ? `bodybuild:${bodybuild.id}` : `free_exercise_db:${free?.id ?? ''}`
  return links.name_overrides[sourceRef] ?? links.name_overrides[deriveKey(defaultName)] ?? defaultName
}

const nonEmpty = <T>(value: T | undefined, size: (v: T) => number): T | undefined =>
  value !== undefined && size(value) > 0 ? value : undefined

const draftSameAs = ({ bodybuild, free }: Draft, wikidata: string | undefined): ExerciseCatalogSameAs => ({
  ...(bodybuild ? { bodybuild: bodybuild.id } : {}),
  ...(free ? { free_exercise_db: free.id } : {}),
  ...(wikidata ? { wikidata } : {}),
})

const draftAliases = ({ bodybuild, free }: Draft, name: string, curated: string[] = []): string[] => {
  const differs = free !== undefined && normalizeExerciseName(free.name) !== normalizeExerciseName(name)
  return unique([...(bodybuild && differs ? [free.name] : []), ...curated])
}

const isEquipment = (value: string): value is ExerciseEquipment =>
  (exerciseEquipment as readonly string[]).includes(value)

const equipmentOverride = (key: string, override: string[] | undefined): ExerciseEquipment[] | undefined => {
  if (override === undefined) return undefined
  const unknown = override.filter((value) => !isEquipment(value))
  if (unknown.length > 0) {
    throw new Error(`links.json: equipment.${key} has unknown equipment ${unknown.join(', ')}`)
  }
  return override.filter(isEquipment)
}

const draftEquipment = ({ bodybuild, free }: Draft, override: ExerciseEquipment[] | undefined) =>
  override ?? nonEmpty(bodybuild?.equipment, (e) => e.length) ?? free?.equipment ?? []

const draftMuscles = ({ bodybuild, free }: Draft) =>
  sortMuscles(nonEmpty(bodybuild?.muscles, (m) => Object.keys(m).length) ?? free?.muscles ?? {})

const draftEntry = (draft: Draft, links: CatalogLinks): StoredExerciseCatalogEntry => {
  const name = draftName(draft, links)
  const key = deriveKey(name)
  return {
    key,
    name,
    aliases: draftAliases(draft, name, links.aliases[key]),
    search_terms: unique(draft.bodybuild?.search_aliases ?? []),
    category: draft.free?.category ?? 'strength',
    equipment: draftEquipment(draft, equipmentOverride(key, links.equipment[key])),
    muscles: draftMuscles(draft),
    same_as: draftSameAs(draft, links.wikidata[key]),
  }
}

const resolveDrafts = (bodybuild: BodybuildSourceFile, free: FreeExerciseSourceFile, links: CatalogLinks) => {
  const freeById = new Map(free.entries.map((e) => [e.id, e]))
  const bodybuildIds = new Set(bodybuild.entries.map((e) => e.id))
  const linkedFree = new Map<string, string>()
  for (const [bodybuildId, freeId] of Object.entries(links.links)) {
    if (!bodybuildIds.has(bodybuildId)) throw new Error(`links.json: unknown body.build id '${bodybuildId}'`)
    if (!freeById.has(freeId)) throw new Error(`links.json: unknown free-exercise-db id '${freeId}'`)
    const previous = linkedFree.get(freeId)
    if (previous) {
      throw new Error(`links.json: '${freeId}' is linked to both '${previous}' and '${bodybuildId}'`)
    }
    linkedFree.set(freeId, bodybuildId)
  }
  return [
    ...bodybuild.entries.map((e): Draft => {
      const freeId = links.links[e.id]
      return { bodybuild: e, free: freeId ? freeById.get(freeId) : undefined }
    }),
    ...free.entries.filter((e) => !linkedFree.has(e.id)).map((e): Draft => ({ free: e })),
  ]
}

const assertUnique = (entries: StoredExerciseCatalogEntry[]) => {
  const keys = new Map<string, string>()
  const names = new Map<string, string>()
  const collisions: string[] = []
  for (const entry of entries) {
    const other = keys.get(entry.key)
    if (other) collisions.push(`key '${entry.key}': '${other}' and '${entry.name}'`)
    keys.set(entry.key, entry.name)
    for (const label of [entry.name, ...entry.aliases]) {
      const normalized = normalizeExerciseName(label)
      const owner = names.get(normalized)
      if (owner) collisions.push(`'${label}' (${entry.key}) collides with ${owner}`)
      else names.set(normalized, `'${label}' (${entry.key})`)
    }
  }
  if (collisions.length > 0) {
    throw new Error(`Exercise catalogue names are not unique:\n${collisions.join('\n')}`)
  }
}

const assertCuratedKeysExist = (entries: StoredExerciseCatalogEntry[], links: CatalogLinks) => {
  const keys = new Set(entries.map((e) => e.key))
  const overridden = new Set(entries.map((e) => e.name))
  const unusedOverrides = Object.entries(links.name_overrides)
    .filter(([, name]) => !overridden.has(name))
    .map(([ref]) => `name_overrides.${ref}`)
  const unknown = (['aliases', 'equipment', 'wikidata'] as const).flatMap((section) =>
    Object.keys(links[section])
      .filter((key) => !keys.has(key))
      .map((key) => `${section}.${key}`),
  )
  if (unusedOverrides.length + unknown.length > 0) {
    throw new Error(`links.json names unknown keys: ${[...unusedOverrides, ...unknown].join(', ')}`)
  }
}

const byKey = <T extends { key: string }>(a: T, b: T) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)

const isMuscle = (value: string): value is ExerciseMuscle =>
  (exerciseMuscles as readonly string[]).includes(value)

const garminLinkProblems = (
  garmin: GarminSourceFile,
  garminLinks: GarminLinks,
  keys: Set<string>,
): string[] => {
  const sourceFits = new Set(garmin.entries.map((e) => e.fit))
  const sections = ['links', 'variants', 'entries'] as const
  const sectionsOf = (fit: string) => sections.filter((section) => fit in garminLinks[section])
  const placement = garmin.entries.flatMap(({ fit }) => {
    const found = sectionsOf(fit)
    if (found.length === 0) return [`${fit} is in none of links, variants and entries`]
    return found.length > 1 ? [`${fit} is in more than one of ${found.join(', ')}`] : []
  })
  const unknownFits = [...sections, 'name_overrides' as const].flatMap((section) =>
    Object.keys(garminLinks[section])
      .filter(
        (fit) => !sourceFits.has(fit) || (section === 'name_overrides' && !(fit in garminLinks.entries)),
      )
      .map(
        (fit) =>
          `${section}.${fit} is not a ${section === 'name_overrides' ? 'Garmin-only entry' : 'source FIT key'}`,
      ),
  )
  const links = Object.entries(garminLinks.links)
    .filter(([, key]) => !keys.has(key))
    .map(([fit, key]) => `links.${fit} names unknown entry '${key}'`)
  const variants = Object.entries(garminLinks.variants)
    .filter(([, base]) => !(base in garminLinks.links) && !(base in garminLinks.entries))
    .map(([fit, base]) => `variants.${fit} has base '${base}', which is in neither links nor entries`)
  const entries = Object.entries(garminLinks.entries).flatMap(([fit, { category, equipment, muscles }]) => [
    ...((exerciseCategories as readonly string[]).includes(category)
      ? []
      : [`entries.${fit} has unknown category '${category}'`]),
    ...equipment
      .filter((value) => !isEquipment(value))
      .map((value) => `entries.${fit} has unknown equipment '${value}'`),
    ...Object.entries(muscles).flatMap(([muscle, weight]) => [
      ...(isMuscle(muscle) ? [] : [`entries.${fit} has unknown muscle '${muscle}'`]),
      ...(weight > 0 && weight <= 1
        ? []
        : [`entries.${fit} has weight ${weight} for '${muscle}', not in (0, 1]`]),
    ]),
  ])
  return [...placement, ...unknownFits, ...links, ...variants, ...entries]
}

const garminEntry = (
  fit: string,
  name: string,
  curated: GarminLinks['entries'][string],
  links: CatalogLinks,
): StoredExerciseCatalogEntry => {
  const key = deriveKey(name)
  return {
    key,
    name,
    aliases: unique(links.aliases[key] ?? []),
    search_terms: [],
    category: curated.category,
    equipment: equipmentOverride(key, links.equipment[key]) ?? curated.equipment.filter(isEquipment),
    muscles: sortMuscles(curated.muscles as Partial<Record<ExerciseMuscle, number>>),
    same_as: {},
  }
}

const withGarmin = (
  entry: StoredExerciseCatalogEntry,
  fits: string[],
  extraAliases: string[],
  wikidata: string | undefined,
): StoredExerciseCatalogEntry => {
  const { bodybuild, free_exercise_db } = entry.same_as
  return {
    ...entry,
    aliases: [...entry.aliases, ...extraAliases],
    same_as: {
      ...(bodybuild ? { bodybuild } : {}),
      ...(free_exercise_db ? { free_exercise_db } : {}),
      ...(fits.length > 0 ? { fit: fits.toSorted() } : {}),
      ...(wikidata ? { wikidata } : {}),
    },
  }
}

const addGarmin = (
  built: StoredExerciseCatalogEntry[],
  garmin: GarminSourceFile,
  garminLinks: GarminLinks,
  links: CatalogLinks,
): StoredExerciseCatalogEntry[] => {
  const problems = garminLinkProblems(garmin, garminLinks, new Set(built.map((e) => e.key)))
  if (problems.length > 0) throw new Error(`garmin-links.json:\n${problems.join('\n')}`)
  const garminNames = new Map(garmin.entries.map((e) => [e.fit, e.name]))
  const garminOnly = Object.entries(garminLinks.entries).map(([fit, curated]) => ({
    entry: garminEntry(fit, garminLinks.name_overrides[fit] ?? garminNames.get(fit) ?? '', curated, links),
    fit,
  }))
  const keyOfFit = new Map<string, string>([
    ...Object.entries(garminLinks.links),
    ...garminOnly.map(({ entry, fit }): [string, string] => [fit, entry.key]),
  ])
  const fitsOf = new Map<string, string[]>()
  const addFit = (key: string, fit: string) => fitsOf.set(key, [...(fitsOf.get(key) ?? []), fit])
  for (const [fit, key] of keyOfFit) addFit(key, fit)
  for (const [fit, base] of Object.entries(garminLinks.variants)) addFit(keyOfFit.get(base) ?? '', fit)

  const all = [...built, ...garminOnly.map(({ entry }) => entry)]
  const labels = new Map(all.map((e) => [e.key, new Set([e.name, ...e.aliases].map(normalizeExerciseName))]))
  const extraAliases = new Map<string, string[]>()
  for (const [fit, key] of Object.entries(garminLinks.links).toSorted(([a], [b]) => (a < b ? -1 : 1))) {
    const name = garminNames.get(fit) ?? ''
    const known = labels.get(key) ?? new Set()
    if (known.has(normalizeExerciseName(name))) continue
    known.add(normalizeExerciseName(name))
    extraAliases.set(key, [...(extraAliases.get(key) ?? []), name])
  }
  return all.map((entry) =>
    withGarmin(
      entry,
      fitsOf.get(entry.key) ?? [],
      extraAliases.get(entry.key) ?? [],
      entry.same_as.wikidata ?? links.wikidata[entry.key],
    ),
  )
}

export const buildCatalog = (
  bodybuild: BodybuildSourceFile,
  free: FreeExerciseSourceFile,
  links: CatalogLinks,
  garmin: GarminSourceFile,
  garminLinks: GarminLinks,
): StoredExerciseCatalog => {
  const built = resolveDrafts(bodybuild, free, links).map((draft) => draftEntry(draft, links))
  const entries = addGarmin(built, garmin, garminLinks, links).sort(byKey)
  assertUnique(entries)
  assertCuratedKeysExist(entries, links)
  return {
    version: links.version,
    sources: { bodybuild: bodybuild.source, free_exercise_db: free.source, garmin_connect: garmin.source },
    entries,
  }
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T

export const buildCatalogFromFiles = (): string =>
  formatJson(
    buildCatalog(
      readJson<BodybuildSourceFile>('../sources/bodybuild.json'),
      readJson<FreeExerciseSourceFile>('../sources/free-exercise-db.json'),
      readJson<CatalogLinks>('../links.json'),
      readJson<GarminSourceFile>('../sources/garmin.json'),
      readJson<GarminLinks>('../garmin-links.json'),
    ),
  )

export const CATALOG_FILE = new URL('../exercise-catalog.json', import.meta.url)

if (import.meta.main) {
  writeFileSync(CATALOG_FILE, buildCatalogFromFiles())
  console.info(`Wrote ${CATALOG_FILE.pathname}`)
}
