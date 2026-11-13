import type {
  DataFieldCatalog,
  DataSchemaDefinition,
  ItemValueIdentity,
  ItemValueIdentityState,
  SetItemValueIdentityBody,
  StoredExerciseCatalog,
  UnmappedItemValues,
} from '@aurboda/api-spec'

import {
  type ActivityFieldValueRow,
  deleteItemValueIdentity,
  expandActivityTypes,
  getActivityFieldValues,
  getActivityTypeDefinition,
  type ItemValueIdentityRow,
  listItemValueIdentities,
  upsertItemValueIdentity,
} from '../db/index.ts'
import { normalizeItemValue } from './activity-measures.ts'
import {
  findExerciseByName,
  getExerciseByKey,
  loadExerciseCatalog,
  suggestExercises,
  toExerciseCatalogEntry,
} from './exercise-catalog.ts'
import {
  type CatalogItemPath,
  catalogItemPath,
  type ItemValueResult,
  resolveCatalogItemPath,
} from './item-value-aliases.ts'

type Data = Record<string, unknown>

export interface ResolvedIdentity {
  catalog_key: string | null
  state: ItemValueIdentityState
}

export type StoredIdentity = Pick<ItemValueIdentityRow, 'catalog_key' | 'updated_at' | 'value'>
export type LoggedValue = Pick<ActivityFieldValueRow, 'count' | 'value'>

const LOGGED_VALUES_LIMIT = 2000

export const catalogFor = (_catalog: DataFieldCatalog): StoredExerciseCatalog => loadExerciseCatalog()

export const storedIdentityMap = (
  rows: Pick<StoredIdentity, 'catalog_key' | 'value'>[],
): Map<string, string | null> =>
  new Map(
    rows.flatMap((row) => {
      const normalized = normalizeItemValue(row.value)
      return normalized === undefined ? [] : [[normalized, row.catalog_key] as const]
    }),
  )

/**
 * The user's stored decision for the name wins, a stored key the catalogue no longer has resolving
 * as unmapped; otherwise an exact catalogue name or alias; otherwise unmapped.
 */
export const resolveItemValueIdentity = (
  value: string,
  storedByNormalizedValue: Map<string, string | null>,
  catalog: StoredExerciseCatalog,
): ResolvedIdentity => {
  const normalized = normalizeItemValue(value)
  if (normalized !== undefined && storedByNormalizedValue.has(normalized)) {
    const key = storedByNormalizedValue.get(normalized) ?? null
    if (key === null) return { catalog_key: null, state: 'dismissed' }
    return getExerciseByKey(catalog, key)
      ? { catalog_key: key, state: 'user' }
      : { catalog_key: null, state: 'unmapped' }
  }
  const entry = findExerciseByName(catalog, value)
  return entry ? { catalog_key: entry.key, state: 'catalog' } : { catalog_key: null, state: 'unmapped' }
}

export const catalogItemPaths = (schema: DataSchemaDefinition | null | undefined): CatalogItemPath[] =>
  (schema?.fields ?? []).flatMap((field) =>
    (field.item_fields ?? []).flatMap((item) => {
      const path = catalogItemPath(schema, `${field.name}.${item.name}`)
      return path ? [path] : []
    }),
  )

const pathName = (path: CatalogItemPath): string => `${path.list}.${path.key}`

const keyProperty = (path: CatalogItemPath): string => `${path.key}_key`

const isObject = (v: unknown): v is Data => typeof v === 'object' && v !== null && !Array.isArray(v)

const itemsCarryKey = (data: Data, path: CatalogItemPath): boolean => {
  const list = data[path.list]
  return Array.isArray(list) && list.some((item) => isObject(item) && keyProperty(path) in item)
}

export interface ItemValueIdentityContext {
  logged: LoggedValue[]
  stored: StoredIdentity[]
}

export interface ItemValueMapping {
  field: string
  key: string
  value: string
}

/**
 * The name a set written by catalogue key alone gets: the user's own name for the key (the most
 * recently decided logged name mapped to it, else the most used logged name resolving to it),
 * else the catalogue name.
 */
const nameForKey = (
  key: string,
  context: ItemValueIdentityContext,
  stored: Map<string, string | null>,
  catalog: StoredExerciseCatalog,
): string | undefined => {
  const logged = new Set(context.logged.map((v) => normalizeItemValue(v.value)))
  const decided = context.stored
    .filter((row) => row.catalog_key === key && logged.has(normalizeItemValue(row.value)))
    .sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime())[0]
  if (decided) return decided.value.trim()
  const used = context.logged
    .filter((v) => resolveItemValueIdentity(v.value, stored, catalog).catalog_key === key)
    .sort((a, b) => b.count - a.count)[0]
  return used?.value.trim() ?? getExerciseByKey(catalog, key)?.name
}

const applyPathKeys = (
  data: Data,
  path: CatalogItemPath,
  catalog: StoredExerciseCatalog,
  context: ItemValueIdentityContext,
  mappings: Map<string, ItemValueMapping>,
): ItemValueResult<Data> => {
  const list = data[path.list]
  if (!Array.isArray(list)) return { data, success: true }
  const field = pathName(path)
  const property = keyProperty(path)
  const stored = storedIdentityMap(context.stored)
  const next: unknown[] = []
  let changed = false
  for (const [i, item] of list.entries()) {
    if (!isObject(item) || !(property in item)) {
      next.push(item)
      continue
    }
    changed = true
    const { [property]: key, ...rest } = item
    if (key === null || key === undefined) {
      next.push(rest)
      continue
    }
    if (typeof key !== 'string' || !getExerciseByKey(catalog, key)) {
      return {
        error: `${path.list}[${i}].${property}: unknown exercise catalogue key "${String(key)}"`,
        success: false,
      }
    }
    const name = rest[path.key]
    const normalized = typeof name === 'string' ? normalizeItemValue(name) : undefined
    if (typeof name !== 'string' || normalized === undefined) {
      next.push({ ...rest, [path.key]: nameForKey(key, context, stored, catalog) })
      continue
    }
    if (resolveItemValueIdentity(name, stored, catalog).catalog_key !== key) {
      stored.set(normalized, key)
      mappings.set(`${field}\u0000${normalized}`, { field, key, value: name.trim() })
    }
    next.push(rest)
  }
  return { data: changed ? { ...data, [path.list]: next } : data, success: true }
}

/**
 * `data` with every `<item>_key` of a catalogue-backed item field taken off its list item: a key
 * alone names the item, a key next to a name that does not already resolve to it becomes a
 * mapping to store. With no key carried, the same reference comes back.
 */
export const applyItemValueKeys = <T extends Data | undefined>(
  schema: DataSchemaDefinition | null | undefined,
  data: T,
  catalogs: (catalog: DataFieldCatalog) => StoredExerciseCatalog,
  contexts: Record<string, ItemValueIdentityContext>,
): ItemValueResult<{ data: T; mappings: ItemValueMapping[] }> => {
  const mappings = new Map<string, ItemValueMapping>()
  if (data === undefined) return { data: { data, mappings: [] }, success: true }
  let result: Data = data
  for (const path of catalogItemPaths(schema)) {
    if (!itemsCarryKey(result, path)) continue
    const context = contexts[pathName(path)] ?? { logged: [], stored: [] }
    const applied = applyPathKeys(result, path, catalogs(path.catalog), context, mappings)
    if (!applied.success) return applied
    result = applied.data
  }
  return { data: { data: result as T, mappings: [...mappings.values()] }, success: true }
}

const loggedValues = async (
  user: string,
  activityType: string,
  field: string,
): Promise<ActivityFieldValueRow[]> =>
  getActivityFieldValues(user, await expandActivityTypes(user, [activityType]), field, LOGGED_VALUES_LIMIT)

/**
 * Resolve the catalogue keys a write carries (see `applyItemValueKeys`), reading the user's
 * identities and logged values only when some item carries one. The mappings are returned for
 * `storeItemValueMappings` once the write is valid.
 */
export const applyItemValueKeysForWrite = async <T extends Data | undefined>(
  user: string,
  activityType: string,
  data: T,
): Promise<ItemValueResult<{ data: T; mappings: ItemValueMapping[] }>> => {
  if (data === undefined || !Object.values(data).some(Array.isArray)) {
    return { data: { data, mappings: [] }, success: true }
  }
  const schema = (await getActivityTypeDefinition(user, activityType))?.data_schema
  const keyed = catalogItemPaths(schema).filter((path) => itemsCarryKey(data, path))
  if (keyed.length === 0) return { data: { data, mappings: [] }, success: true }
  const contexts: Record<string, ItemValueIdentityContext> = {}
  for (const path of keyed) {
    const field = pathName(path)
    const [stored, logged] = await Promise.all([
      listItemValueIdentities(user, field),
      loggedValues(user, activityType, field),
    ])
    contexts[field] = { logged, stored }
  }
  return applyItemValueKeys(schema, data, catalogFor, contexts)
}

export const storeItemValueMappings = async (user: string, mappings: ItemValueMapping[]): Promise<void> => {
  for (const mapping of mappings) {
    await upsertItemValueIdentity(user, mapping.field, mapping.value, mapping.key)
  }
}

const describeValue = (
  path: CatalogItemPath,
  field: string,
  value: string,
  stored: Map<string, string | null>,
  logged: LoggedValue[],
): ItemValueIdentity => {
  const catalog = catalogFor(path.catalog)
  const resolved = resolveItemValueIdentity(value, stored, catalog)
  const entry = resolved.catalog_key === null ? undefined : getExerciseByKey(catalog, resolved.catalog_key)
  const normalized = normalizeItemValue(value)
  const otherValues =
    resolved.catalog_key === null
      ? []
      : logged
          .filter(
            (v) =>
              normalizeItemValue(v.value) !== normalized &&
              resolveItemValueIdentity(v.value, stored, catalog).catalog_key === resolved.catalog_key,
          )
          .map((v) => ({ count: v.count, value: v.value }))
  return {
    catalog: path.catalog,
    catalog_key: resolved.catalog_key,
    catalog_version: catalog.version,
    ...(entry ? { entry: toExerciseCatalogEntry(entry) } : {}),
    field,
    other_values: otherValues,
    state: resolved.state,
    value,
  }
}

export const getItemValueIdentity = async (
  user: string,
  activityType: string,
  field: string,
  value: string,
): Promise<ItemValueResult<ItemValueIdentity>> => {
  const resolved = await resolveCatalogItemPath(user, activityType, field)
  if (!resolved.success) return resolved
  const [stored, logged] = await Promise.all([
    listItemValueIdentities(user, field),
    loggedValues(user, activityType, field),
  ])
  return {
    data: describeValue(resolved.data, field, value.trim(), storedIdentityMap(stored), logged),
    success: true,
  }
}

export const setItemValueIdentity = async (
  user: string,
  activityType: string,
  body: SetItemValueIdentityBody,
): Promise<ItemValueResult<ItemValueIdentity>> => {
  const resolved = await resolveCatalogItemPath(user, activityType, body.field)
  if (!resolved.success) return resolved
  if (body.key !== null && !getExerciseByKey(catalogFor(resolved.data.catalog), body.key)) {
    return { error: `Unknown exercise catalogue key "${body.key}"`, success: false }
  }
  const value = body.value.trim()
  await upsertItemValueIdentity(user, body.field, value, body.key)
  return getItemValueIdentity(user, activityType, body.field, value)
}

export const clearItemValueIdentity = async (
  user: string,
  activityType: string,
  field: string,
  value: string,
): Promise<{ error?: string; success: boolean }> => {
  const resolved = await resolveCatalogItemPath(user, activityType, field)
  if (!resolved.success) return resolved
  return (await deleteItemValueIdentity(user, field, value))
    ? { success: true }
    : { error: `Identity for "${value.trim()}" not found`, success: false }
}

export const listUnmappedItemValues = async (
  user: string,
  activityType: string,
  field: string,
): Promise<ItemValueResult<UnmappedItemValues>> => {
  const resolved = await resolveCatalogItemPath(user, activityType, field)
  if (!resolved.success) return resolved
  const catalog = catalogFor(resolved.data.catalog)
  const [stored, logged] = await Promise.all([
    listItemValueIdentities(user, field),
    loggedValues(user, activityType, field),
  ])
  const storedMap = storedIdentityMap(stored)
  const values = logged
    .filter((v) => resolveItemValueIdentity(v.value, storedMap, catalog).state === 'unmapped')
    .sort((a, b) => b.count - a.count || b.last_used.getTime() - a.last_used.getTime())
    .map((v) => ({
      count: v.count,
      last_used: v.last_used.toISOString(),
      suggestions: suggestExercises(catalog, v.value).map(toExerciseCatalogEntry),
      value: v.value,
    }))
  return {
    data: { catalog: resolved.data.catalog, catalog_version: catalog.version, field, values },
    success: true,
  }
}

/** The identity fields of field values when `field` is a catalogue-backed item path of the type. */
export const resolveFieldValueIdentities = async <V extends { value: string }>(
  user: string,
  activityType: string,
  field: string,
  values: V[],
): Promise<
  { catalog: DataFieldCatalog; catalog_version: string; values: (V & ResolvedIdentity)[] } | undefined
> => {
  const definition = await getActivityTypeDefinition(user, activityType)
  const path = catalogItemPath(definition?.data_schema, field)
  if (!path) return undefined
  const catalog = catalogFor(path.catalog)
  const stored = storedIdentityMap(await listItemValueIdentities(user, field))
  return {
    catalog: path.catalog,
    catalog_version: catalog.version,
    values: values.map((v) => ({ ...v, ...resolveItemValueIdentity(v.value, stored, catalog) })),
  }
}
