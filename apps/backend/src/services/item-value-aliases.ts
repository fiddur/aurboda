import type {
  DataSchemaDefinition,
  ItemValueAlias,
  MergeItemValuesBody,
  MergeItemValuesResult,
} from '@aurboda/api-spec'

import { z } from 'zod'

import {
  deleteItemValueAlias,
  deleteItemValueAliasesByAlias,
  expandActivityTypes,
  getActivityTypeDefinition,
  type ItemValueAliasRow,
  listItemValueAliases,
  repointItemValueAliases,
  rewriteItemValue,
  upsertItemValueAlias,
} from '../db/index.ts'
import { normalizeItemValue, parseFieldPath } from './activity-measures.ts'

type Data = Record<string, unknown>

export type AliasMapping = Pick<ItemValueAliasRow, 'alias' | 'field' | 'value'>

export type ItemValueResult<T> = { data: T; success: true } | { error: string; success: false }

export interface ItemPath {
  list: string
  key: string
}

const isObject = (v: unknown): v is Data => typeof v === 'object' && v !== null && !Array.isArray(v)

/** `path` as `{ list, key }` when it names a categorical item field of a list field in `schema`. */
export const categoricalItemPath = (
  schema: DataSchemaDefinition | null | undefined,
  path: string,
): ItemPath | undefined => {
  const { field, key } = parseFieldPath(path)
  if (key === undefined) return undefined
  const list = schema?.fields.find((f) => f.name === field && f.type === 'list')
  const item = list?.item_fields?.find((f) => f.name === key)
  return item?.is_categorical ? { key, list: field } : undefined
}

/**
 * `data` with every list item whose aliased field matches an alias (trimmed, case-insensitive)
 * set to the alias's value. The input is never mutated; with nothing matched the same reference
 * comes back.
 */
export const applyItemValueAliases = <T extends Data | undefined>(data: T, aliases: AliasMapping[]): T => {
  if (data === undefined || aliases.length === 0) return data
  let result: Data = data
  for (const alias of aliases) {
    const { field, key } = parseFieldPath(alias.field)
    const list = result[field]
    const from = normalizeItemValue(alias.alias)
    if (key === undefined || from === undefined || !Array.isArray(list)) continue
    let changed = false
    const next = list.map((item: unknown) => {
      if (!isObject(item) || normalizeItemValue(item[key]) !== from) return item
      changed = true
      return { ...item, [key]: alias.value }
    })
    if (changed) result = { ...result, [field]: next }
  }
  return result as T
}

const hasList = (data: Data): boolean => Object.values(data).some(Array.isArray)

export const aliasActivityData = async <T extends Data | undefined>(user: string, data: T): Promise<T> => {
  if (data === undefined || !hasList(data)) return data
  const aliases = await listItemValueAliases(user)
  return applyItemValueAliases(data, aliases)
}

export const serializeItemValueAlias = (row: ItemValueAliasRow): ItemValueAlias => ({
  alias: row.alias,
  created_at: row.created_at.toISOString(),
  field: row.field,
  id: row.id,
  value: row.value,
})

const resolveItemPath = async (
  user: string,
  activityType: string,
  field: string,
): Promise<ItemValueResult<ItemPath>> => {
  const definition = await getActivityTypeDefinition(user, activityType)
  if (!definition) return { error: `Activity type "${activityType}" not found`, success: false }
  const path = categoricalItemPath(definition.data_schema, field)
  if (!path) {
    return {
      error: `"${field}" is not a categorical item field of a list field of "${activityType}"`,
      success: false,
    }
  }
  return { data: path, success: true }
}

/**
 * Rewrite `source` to `target` in the item path across the type and its descendants. Unless the
 * two differ only in spelling, `source` becomes an alias of `target`: aliases that pointed at
 * `source` follow it to `target`, and an alias spelled like `target` is dropped since `target`
 * is a value again.
 */
export const mergeItemValues = async (
  user: string,
  activityType: string,
  body: MergeItemValuesBody,
): Promise<ItemValueResult<MergeItemValuesResult>> => {
  const resolved = await resolveItemPath(user, activityType, body.field)
  if (!resolved.success) return resolved
  const { key, list } = resolved.data

  const source = body.source.trim()
  const target = body.target.trim()
  const normalizedSource = normalizeItemValue(source)
  const normalizedTarget = normalizeItemValue(target)
  if (normalizedSource === undefined || normalizedTarget === undefined) {
    return { error: 'source and target must not be empty', success: false }
  }
  if (source === target) return { error: 'source and target are the same value', success: false }
  const spellingOnly = normalizedSource === normalizedTarget

  const types = await expandActivityTypes(user, [activityType])
  const activitiesUpdated = await rewriteItemValue(user, types, list, key, source, target)
  await repointItemValueAliases(user, body.field, source, target)
  if (spellingOnly) return { data: { activities_updated: activitiesUpdated, alias: null }, success: true }

  await deleteItemValueAliasesByAlias(user, body.field, target)
  const alias = await upsertItemValueAlias(user, body.field, source, target)
  return {
    data: { activities_updated: activitiesUpdated, alias: serializeItemValueAlias(alias) },
    success: true,
  }
}

export const listAliases = async (
  user: string,
  activityType: string,
  field: string,
): Promise<ItemValueResult<ItemValueAlias[]>> => {
  const resolved = await resolveItemPath(user, activityType, field)
  if (!resolved.success) return resolved
  const rows = await listItemValueAliases(user, field)
  return { data: rows.map(serializeItemValueAlias), success: true }
}

export const deleteAlias = async (
  user: string,
  id: string,
): Promise<{ error?: string; success: boolean }> => {
  const found = z.string().uuid().safeParse(id).success && (await deleteItemValueAlias(user, id))
  return found ? { success: true } : { error: 'Alias not found', success: false }
}
