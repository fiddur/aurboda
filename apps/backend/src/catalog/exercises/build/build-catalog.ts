import {
  type ExerciseCatalogSameAs,
  type ExerciseEquipment,
  type ExerciseMuscle,
  exerciseEquipment,
  type StoredExerciseCatalog,
  type StoredExerciseCatalogEntry,
} from '@aurboda/api-spec'
import { readFileSync, writeFileSync } from 'node:fs'

import type { BodybuildExercise, BodybuildSourceFile } from './convert-bodybuild.ts'
import type { FreeExercise, FreeExerciseSourceFile } from './trim-free-exercise-db.ts'

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

export const buildCatalog = (
  bodybuild: BodybuildSourceFile,
  free: FreeExerciseSourceFile,
  links: CatalogLinks,
): StoredExerciseCatalog => {
  const entries = resolveDrafts(bodybuild, free, links)
    .map((draft) => draftEntry(draft, links))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  assertUnique(entries)
  assertCuratedKeysExist(entries, links)
  return {
    version: links.version,
    sources: { bodybuild: bodybuild.source, free_exercise_db: free.source },
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
    ),
  )

export const CATALOG_FILE = new URL('../exercise-catalog.json', import.meta.url)

if (import.meta.main) {
  writeFileSync(CATALOG_FILE, buildCatalogFromFiles())
  console.info(`Wrote ${CATALOG_FILE.pathname}`)
}
