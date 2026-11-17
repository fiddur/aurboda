import type { DataFieldCatalog, DataSchemaDefinition, ExerciseCatalogEntry } from '@aurboda/api-spec'

import { listFields } from '../../components/sessions/sessionView'

const PRIMARY_WEIGHT = 0.75

export type TierMuscle = Pick<ExerciseCatalogEntry['muscles'][number], 'group' | 'name'>

const tierMuscle = ({ group, name }: TierMuscle): TierMuscle => ({ group, name })

export const muscleTiers = (
  entry: ExerciseCatalogEntry,
): { primary: TierMuscle[]; secondary: TierMuscle[] } => ({
  primary: entry.muscles.filter((m) => m.weight >= PRIMARY_WEIGHT).map(tierMuscle),
  secondary: entry.muscles.filter((m) => m.weight < PRIMARY_WEIGHT).map(tierMuscle),
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
