import type {
  ActivityTypeCatalogResult,
  ActivityTypeDefinition,
  AddActivityTypeDefinitionBody,
  DataSchemaDefinition,
  StoredActivityTypeCatalog,
  StoredActivityTypeCatalogEntry,
} from '@aurboda/api-spec'

import { builtinActivityTypes } from '@aurboda/api-spec'

import {
  adoptCatalogActivityType,
  deleteActivityTypeDefinition as dbDelete,
  ensureActivityType,
  getActivityTypeDefinition as dbGet,
  getActivityTypeDefinitions as dbList,
  insertActivityTypeDefinition as dbInsert,
  mergeActivityTypeDefinition as dbMerge,
  renameActivityTypeDefinition as dbRename,
  updateActivityTypeDefinition as dbUpdate,
} from '../db/index.ts'
import {
  getCatalogActivityType,
  loadActivityTypeCatalog,
  missingCatalogFields,
  searchActivityTypeCatalog,
  toActivityTypeCatalogEntry,
} from './activity-type-catalog.ts'
import { validatePartialActivityData } from './data-schema-validation.ts'

export interface ActivityTypeDefinitionResult {
  success: boolean
  data?: ActivityTypeDefinition
  error?: string
}

export const listActivityTypeDefinitions = async (user: string): Promise<ActivityTypeDefinition[]> =>
  dbList(user)

/** A catalogue type takes every field the caller leaves out from its catalogue definition. */
export const addActivityTypeDefinition = async (
  user: string,
  input: AddActivityTypeDefinitionBody,
  catalog: StoredActivityTypeCatalog = loadActivityTypeCatalog(),
): Promise<ActivityTypeDefinitionResult> => {
  // Block names that conflict with built-in types
  if ((builtinActivityTypes as readonly string[]).includes(input.name)) {
    return { error: `"${input.name}" is a built-in activity type and cannot be recreated`, success: false }
  }

  const existing = await dbGet(user, input.name)
  if (existing) {
    return { error: `Activity type "${input.name}" already exists`, success: false }
  }

  const entry = getCatalogActivityType(catalog, input.name)
  if (!entry) {
    const { display_category, display_name } = input
    if (display_name === undefined || display_category === undefined) {
      return {
        error:
          'display_name and display_category are required for a type that is not in the built-in catalogue',
        success: false,
      }
    }
    return { data: await dbInsert(user, { ...input, display_category, display_name }), success: true }
  }

  return { data: await insertFromCatalog(user, input, entry, catalog), success: true }
}

const insertFromCatalog = async (
  user: string,
  input: AddActivityTypeDefinitionBody,
  entry: StoredActivityTypeCatalogEntry,
  catalog: StoredActivityTypeCatalog,
): Promise<ActivityTypeDefinition> => {
  if (input.parent_type === undefined && entry.parent_type !== undefined) {
    await adoptCatalogActivityType(user, entry.parent_type, catalog)
  }
  return dbInsert(user, {
    ...input,
    aliases: [...new Set([...(input.aliases ?? []), ...entry.aliases])],
    color: input.color ?? entry.color,
    data_schema: input.data_schema ?? entry.data_schema,
    display_category: input.display_category ?? entry.display_category,
    display_name: input.display_name ?? entry.display_name,
    icon: input.icon ?? entry.icon,
    parent_type: input.parent_type ?? entry.parent_type,
  })
}

/**
 * The catalogue entries matching `q`, each marked with whether the user already has a type of that name and
 * which catalogue fields that type lacks.
 */
export const listActivityTypeCatalog = async (
  user: string,
  q?: string,
  catalog: StoredActivityTypeCatalog = loadActivityTypeCatalog(),
): Promise<ActivityTypeCatalogResult> => {
  const definitions = new Map((await dbList(user)).map((def) => [def.name, def]))
  return {
    entries: searchActivityTypeCatalog(catalog, q).map((entry) => {
      const def = definitions.get(entry.name)
      const missing = def ? missingCatalogFields(entry, def.data_schema).map((field) => field.name) : []
      return toActivityTypeCatalogEntry(entry, def !== undefined, missing)
    }),
    groups: catalog.groups,
    version: catalog.version,
  }
}

export const updateActivityTypeDefinition = async (
  user: string,
  name: string,
  updates: {
    display_name?: string
    display_category?: string
    color?: string
    icon?: string | null
    aliases?: string[]
    show_on_timeline?: boolean
    data_schema?: DataSchemaDefinition | null
  },
): Promise<ActivityTypeDefinitionResult> => {
  const existing = await dbGet(user, name)
  if (!existing) {
    return { error: `Activity type "${name}" not found`, success: false }
  }

  const updated = await dbUpdate(user, name, updates)
  if (!updated) {
    return { error: 'Failed to update activity type definition', success: false }
  }

  return { data: updated, success: true }
}

/** Appends the catalogue fields the user's type of a catalogue name lacks; fields it has are never changed. */
export const addCatalogFieldsToActivityType = async (
  user: string,
  name: string,
  catalog: StoredActivityTypeCatalog = loadActivityTypeCatalog(),
): Promise<ActivityTypeDefinitionResult> => {
  const existing = await dbGet(user, name)
  if (!existing) return { error: `Activity type "${name}" not found`, success: false }

  const entry = getCatalogActivityType(catalog, name)
  if (!entry) return { error: `"${name}" is not a built-in catalogue type`, success: false }

  const missing = missingCatalogFields(entry, existing.data_schema)
  if (missing.length === 0) return { data: existing, success: true }

  const updated = await dbUpdate(user, name, {
    data_schema: { fields: [...(existing.data_schema?.fields ?? []), ...missing] },
  })
  if (!updated) return { error: 'Failed to update activity type definition', success: false }
  return { data: updated, success: true }
}

export const deleteActivityTypeDefinition = async (
  user: string,
  name: string,
): Promise<{ success: boolean; error?: string }> => {
  if ((builtinActivityTypes as readonly string[]).includes(name)) {
    return { error: `Cannot delete built-in activity type "${name}"`, success: false }
  }

  const deleted = await dbDelete(user, name)
  if (!deleted) {
    return { error: `Activity type "${name}" not found`, success: false }
  }

  return { success: true }
}

export interface RenameActivityTypeResult {
  success: boolean
  error?: string
  data?: ActivityTypeDefinition
  activities_updated?: number
  deduction_rules_updated?: number
}

export const renameActivityTypeDefinition = async (
  user: string,
  oldName: string,
  newName: string,
): Promise<RenameActivityTypeResult> => {
  if (oldName === newName) {
    return { error: 'New name is the same as the current name.', success: false }
  }

  if ((builtinActivityTypes as readonly string[]).includes(oldName)) {
    return { error: `Cannot rename built-in activity type "${oldName}".`, success: false }
  }

  if ((builtinActivityTypes as readonly string[]).includes(newName)) {
    return { error: `Cannot rename to built-in activity type name "${newName}".`, success: false }
  }

  const result = await dbRename(user, oldName, newName)
  if (!result) {
    return { error: `Activity type "${oldName}" not found or "${newName}" already exists.`, success: false }
  }

  return {
    activities_updated: result.activities_updated,
    data: result.definition,
    deduction_rules_updated: result.deduction_rules_updated,
    success: true,
  }
}

export interface MergeActivityTypeResult {
  success: boolean
  error?: string
  activities_data_set?: number
  activities_reassigned?: number
  deduction_rules_updated?: number
  target?: ActivityTypeDefinition
}

const setDataErrorFor = (
  setData: Record<string, unknown> | undefined,
  target: string,
  schema: DataSchemaDefinition | null | undefined,
): string | undefined => {
  if (!setData) return undefined
  const validation = validatePartialActivityData(setData, schema)
  return validation.valid
    ? undefined
    : `set_data is not valid for "${target}": ${(validation.errors ?? []).join('; ')}`
}

/**
 * The schema `setData` is checked against: the target's own, with the catalogue fields `setData` names that
 * the target lacks appended (the same object as the target's when there are none), or the catalogue entry's
 * for a target not adopted yet.
 */
const mergeTargetSchema = (
  targetDef: ActivityTypeDefinition | null,
  targetEntry: StoredActivityTypeCatalogEntry | undefined,
  setData: Record<string, unknown> | undefined,
): DataSchemaDefinition | null | undefined => {
  if (!targetDef) return targetEntry?.data_schema
  const borrowed =
    targetEntry && setData
      ? missingCatalogFields(targetEntry, targetDef.data_schema).filter((field) => field.name in setData)
      : []
  return borrowed.length === 0
    ? targetDef.data_schema
    : { fields: [...(targetDef.data_schema?.fields ?? []), ...borrowed] }
}

/**
 * All activities are reassigned, aliases merged, deduction rules updated, source deleted. A target that is a
 * catalogue type not used yet is adopted first, and a target of a catalogue name gets the catalogue fields
 * `setData` names that it lacks. `setData` fills those fields on the moved activities that have no value
 * for them.
 */
export const mergeActivityType = async (
  user: string,
  source: string,
  target: string,
  setData?: Record<string, unknown>,
  catalog: StoredActivityTypeCatalog = loadActivityTypeCatalog(),
): Promise<MergeActivityTypeResult> => {
  if (source === target) {
    return { error: 'Source and target cannot be the same activity type.', success: false }
  }

  if ((builtinActivityTypes as readonly string[]).includes(source)) {
    return { error: `Cannot merge built-in activity type "${source}".`, success: false }
  }

  const notFound = { error: `Activity type "${source}" or "${target}" not found.`, success: false }
  if (!(await dbGet(user, source))) return notFound
  const targetDef = await dbGet(user, target)
  const targetEntry = getCatalogActivityType(catalog, target)
  if (!targetDef && !targetEntry) return notFound

  const data = setData && Object.keys(setData).length > 0 ? setData : undefined
  const schema = mergeTargetSchema(targetDef, targetEntry, data)
  const setDataError = setDataErrorFor(data, target, schema)
  if (setDataError) return { error: setDataError, success: false }
  if (!(await ensureActivityType(user, target, catalog))) return notFound
  if (
    targetDef &&
    schema !== targetDef.data_schema &&
    !(await dbUpdate(user, target, { data_schema: schema }))
  ) {
    return notFound
  }

  const result = await dbMerge(user, source, target, data)
  if (!result) return notFound

  return {
    activities_data_set: result.activities_data_set,
    activities_reassigned: result.activities_reassigned,
    deduction_rules_updated: result.deduction_rules_updated,
    success: true,
    target: result.target,
  }
}
