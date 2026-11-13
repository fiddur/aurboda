import type { DataFieldCatalog, DataSchemaDefinition, ExerciseCatalogEntry } from '@aurboda/api-spec'

import { listFields } from '../../components/sessions/sessionView'

const PRIMARY_WEIGHT = 0.75

export const muscleTiers = (entry: ExerciseCatalogEntry): { primary: string[]; secondary: string[] } => ({
  primary: entry.muscles.filter((m) => m.weight >= PRIMARY_WEIGHT).map((m) => m.name),
  secondary: entry.muscles.filter((m) => m.weight < PRIMARY_WEIGHT).map((m) => m.name),
})

export const itemFieldCatalog = (
  schema: DataSchemaDefinition | undefined,
  path: string,
): DataFieldCatalog | undefined => {
  const [listName, itemName] = path.split('.')
  return listFields(schema)
    .find((list) => list.name === listName)
    ?.item_fields.find((item) => item.name === itemName)?.catalog
}
