/**
 * Activity type definition service — CRUD for custom activity types.
 */
import type { ActivityTypeDefinition } from '@aurboda/api-spec'

import { builtinActivityTypes } from '@aurboda/api-spec'

import {
  deleteActivityTypeDefinition as dbDelete,
  getActivityTypeDefinition as dbGet,
  getActivityTypeDefinitions as dbList,
  insertActivityTypeDefinition as dbInsert,
  updateActivityTypeDefinition as dbUpdate,
} from '../db/index.ts'

export interface ActivityTypeDefinitionResult {
  success: boolean
  data?: ActivityTypeDefinition
  error?: string
}

export const listActivityTypeDefinitions = async (user: string): Promise<ActivityTypeDefinition[]> =>
  dbList(user)

export const addActivityTypeDefinition = async (
  user: string,
  input: {
    name: string
    display_name: string
    display_category: string
    color?: string
    icon?: string
    aliases?: string[]
  },
): Promise<ActivityTypeDefinitionResult> => {
  // Block names that conflict with built-in types
  if ((builtinActivityTypes as readonly string[]).includes(input.name)) {
    return { error: `"${input.name}" is a built-in activity type and cannot be recreated`, success: false }
  }

  // Check for existing definition
  const existing = await dbGet(user, input.name)
  if (existing) {
    return { error: `Activity type "${input.name}" already exists`, success: false }
  }

  const def = await dbInsert(user, input)
  return { data: def, success: true }
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
