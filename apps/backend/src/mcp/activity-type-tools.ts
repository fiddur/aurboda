import {
  activityTypeCatalogQuerySchema,
  addActivityTypeDefinitionBodySchema,
  itemValueAliasesQuerySchema,
  itemValueIdentityQuerySchema,
  mergeItemValuesBodySchema,
  setItemValueIdentityBodySchema,
  unmappedItemValuesQuerySchema,
  updateActivityTypeDefinitionBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import {
  addActivityTypeDefinition,
  deleteActivityTypeDefinition,
  listActivityTypeCatalog,
  listActivityTypeDefinitions,
  mergeActivityType,
  renameActivityTypeDefinition,
  updateActivityTypeDefinition,
} from '../services/activity-type-definitions.ts'
import { deleteAlias, listAliases, mergeItemValues } from '../services/item-value-aliases.ts'
import {
  clearItemValueIdentity,
  getItemValueIdentity,
  listUnmappedItemValues,
  setItemValueIdentity,
} from '../services/item-value-identities.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export const registerActivityTypeTools = (server: McpServer, user: string) => {
  server.tool(
    'list_activity_types',
    'List all activity type definitions (built-in and custom). Returns display metadata including name, display_name, display_category, color, and icon.',
    {},
    async () => {
      const definitions = await listActivityTypeDefinitions(user)
      return jsonResponse(definitions)
    },
  )

  server.tool(
    'list_activity_type_catalog',
    "List Aurboda's built-in activity types for things logged by hand (intake, meals and diet, health, symptoms, recovery, context), each with its fields. `in_use` says whether the user already has a type of that name. A type not in use is added automatically the first time add_activity uses its name, or with add_activity_type given only the name. Check here before creating a custom type.",
    { ...activityTypeCatalogQuerySchema.shape },
    async ({ q }) => jsonResponse(await listActivityTypeCatalog(user, q)),
  )

  server.tool(
    'add_activity_type',
    'Create a custom activity type definition. The name must be snake_case (e.g. "sauna", "driving", "hot_bath"). Many types are built in (list_activity_types), and with a name from list_activity_type_catalog only `name` is needed: the catalogue fills in display name, category, icon and fields. A data_schema field of type `list` carries `item_fields` and holds an array of objects, e.g. the `sets` of a strength session (`exercise`, `weight`, `reps`, `time`).',
    { ...addActivityTypeDefinitionBodySchema.shape },
    async (params) => {
      const result = await addActivityTypeDefinition(user, params)
      if (!result.success) return errorResponse(result.error ?? 'Failed to create activity type')
      return jsonResponse(result.data)
    },
  )

  server.tool(
    'update_activity_type',
    'Update an activity type definition. Can modify display_name, display_category, color, and icon for both built-in and custom types. A data_schema field of type `list` carries `item_fields` and holds an array of objects, e.g. the `sets` of a strength session (`exercise`, `weight`, `reps`, `time`).',
    {
      name: z.string().describe('Name of the activity type to update'),
      ...updateActivityTypeDefinitionBodySchema.shape,
    },
    async ({ name, ...updates }) => {
      const result = await updateActivityTypeDefinition(user, name, updates)
      if (!result.success) return errorResponse(result.error ?? 'Failed to update activity type')
      return jsonResponse(result.data)
    },
  )

  server.tool(
    'delete_activity_type',
    'Delete a custom activity type definition. Built-in types (sleep, exercise, meditation, nap, rest) cannot be deleted.',
    { name: z.string().describe('Name of the activity type to delete') },
    async ({ name }) => {
      const result = await deleteActivityTypeDefinition(user, name)
      if (!result.success) return errorResponse(result.error ?? 'Failed to delete activity type')
      return jsonResponse({ deleted: true, name })
    },
  )

  server.tool(
    'rename_activity_type',
    "Rename a custom activity type's snake_case identifier. Updates all activities and deduction rules that reference the old name. Built-in types cannot be renamed.",
    {
      name: z.string().describe('Current name of the activity type to rename'),
      new_name: z
        .string()
        .regex(/^[a-z][a-z0-9_]*$/)
        .describe('New snake_case name'),
    },
    async ({ name, new_name }) => {
      const result = await renameActivityTypeDefinition(user, name, new_name)
      if (!result.success) return errorResponse(result.error ?? 'Failed to rename activity type')
      return jsonResponse(result)
    },
  )

  server.tool(
    'merge_activity_type',
    'Merge a custom activity type into another activity type (built-in or custom). All activities are reassigned, aliases are merged, deduction rules are updated, and the source custom type definition is deleted. Built-in types cannot be used as the source.',
    {
      source: z.string().describe('Name of the custom activity type to merge away'),
      target: z.string().describe('Name of the target activity type to merge into'),
    },
    async ({ source, target }) => {
      const result = await mergeActivityType(user, source, target)
      if (!result.success) return errorResponse(result.error ?? 'Failed to merge activity type')
      return jsonResponse(result)
    },
  )

  server.tool(
    'merge_item_values',
    'Merge one value of a categorical item path (e.g. the exercise of a strength set, field "sets.exercise") into another: every item with the source value, in the activity type and its subtypes, is rewritten to the target value, and the source becomes an alias of the target, so later writes of that item path (Gravl imports, add_activity, update_activity) carrying the source are stored as the target. Values compare trimmed and case-insensitively; a source differing from the target only in spelling is rewritten without keeping an alias. Returns the number of activities updated and the alias kept.',
    {
      activity_type: z.string().describe('Activity type whose item path to merge in'),
      ...mergeItemValuesBodySchema.shape,
    },
    async ({ activity_type, ...body }) => {
      const result = await mergeItemValues(user, activity_type, body)
      if (!result.success) return errorResponse(result.error)
      return jsonResponse(result.data)
    },
  )

  server.tool(
    'list_item_value_aliases',
    'List the aliases of a categorical item path (e.g. "sets.exercise"): each maps a spelling merged away to the value it is stored as on later writes of that item path, whatever the activity type.',
    {
      activity_type: z.string().describe('Activity type the item path belongs to'),
      ...itemValueAliasesQuerySchema.shape,
    },
    async ({ activity_type, field }) => {
      const result = await listAliases(user, activity_type, field)
      if (!result.success) return errorResponse(result.error)
      return jsonResponse(result.data)
    },
  )

  server.tool(
    'delete_item_value_alias',
    'Delete an item value alias by id. Data already rewritten by the merge stays as it is; only later writes stop being mapped.',
    { id: z.string().uuid().describe('Alias id') },
    async ({ id }) => {
      const result = await deleteAlias(user, id)
      if (!result.success) return errorResponse(result.error ?? 'Failed to delete alias')
      return jsonResponse({ deleted: true, id })
    },
  )

  server.tool(
    'get_item_value_identity',
    'Look up which entry of the built-in exercise catalogue a logged name of a catalogue-backed item path (e.g. "sets.exercise") stands for. state is `user` (the user mapped it), `catalog` (it equals a catalogue name or alias), `dismissed` (the user said it is not in the catalogue) or `unmapped`. Also lists the other logged names that resolve to the same entry. The name need not be logged yet.',
    {
      activity_type: z.string().describe('Activity type the item path belongs to, e.g. strength_training'),
      ...itemValueIdentityQuerySchema.shape,
    },
    async ({ activity_type, field, value }) => {
      const result = await getItemValueIdentity(user, activity_type, field, value)
      if (!result.success) return errorResponse(result.error)
      return jsonResponse(result.data)
    },
  )

  server.tool(
    'set_item_value_identity',
    'Map a logged exercise name to an entry of the built-in exercise catalogue (a key from search_exercise_catalog), or dismiss it as not in the catalogue with key null. Replaces the earlier decision for the name; no activity is rewritten, the identity sits on the name. Returns the name as it now resolves.',
    {
      activity_type: z.string().describe('Activity type the item path belongs to, e.g. strength_training'),
      ...setItemValueIdentityBodySchema.shape,
    },
    async ({ activity_type, ...body }) => {
      const result = await setItemValueIdentity(user, activity_type, body)
      if (!result.success) return errorResponse(result.error)
      return jsonResponse(result.data)
    },
  )

  server.tool(
    'clear_item_value_identity',
    "Remove the user's mapping or dismissal of a logged exercise name, so it resolves against the catalogue automatically again.",
    {
      activity_type: z.string().describe('Activity type the item path belongs to, e.g. strength_training'),
      ...itemValueIdentityQuerySchema.shape,
    },
    async ({ activity_type, field, value }) => {
      const result = await clearItemValueIdentity(user, activity_type, field, value)
      if (!result.success) return errorResponse(result.error ?? 'Failed to clear identity')
      return jsonResponse({ cleared: true, field, value })
    },
  )

  server.tool(
    'list_unmapped_item_values',
    'List the logged exercise names that match no entry of the built-in catalogue, with suggested entries. Leaves out names the user mapped or dismissed; most used first, each with up to three suggestions to pass to set_item_value_identity.',
    {
      activity_type: z.string().describe('Activity type the item path belongs to, e.g. strength_training'),
      ...unmappedItemValuesQuerySchema.shape,
    },
    async ({ activity_type, field }) => {
      const result = await listUnmappedItemValues(user, activity_type, field)
      if (!result.success) return errorResponse(result.error)
      return jsonResponse(result.data)
    },
  )
}
