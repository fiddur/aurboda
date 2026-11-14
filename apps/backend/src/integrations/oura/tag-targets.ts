import type { StoredActivityTypeCatalog } from '@aurboda/api-spec'

import type { OuraTagWithComment } from './client.ts'

export interface OuraTagTarget {
  activity_type: string
  data?: Record<string, boolean | number | string>
}

/** Built-in types outside the catalogue that an Oura code is exactly. */
const builtinTargets: Record<string, string> = { tag_generic_nap: 'nap' }

const targetMaps = new WeakMap<StoredActivityTypeCatalog, Map<string, OuraTagTarget>>()

const targetMapOf = (catalog: StoredActivityTypeCatalog): Map<string, OuraTagTarget> => {
  const cached = targetMaps.get(catalog)
  if (cached) return cached
  const targets = new Map<string, OuraTagTarget>()
  for (const entry of catalog.entries) {
    for (const code of entry.oura_codes ?? []) targets.set(code, { activity_type: entry.name })
    for (const variant of entry.variants ?? []) {
      for (const code of variant.oura_codes ?? []) {
        targets.set(code, { activity_type: entry.name, data: variant.data })
      }
    }
  }
  for (const [code, activity_type] of Object.entries(builtinTargets)) {
    if (!targets.has(code)) targets.set(code, { activity_type })
  }
  targetMaps.set(catalog, targets)
  return targets
}

/** The type, and the field values, an Oura `tag_type_code` is exactly; undefined for a code not known. */
export const ouraTagTarget = (catalog: StoredActivityTypeCatalog, code: string): OuraTagTarget | undefined =>
  targetMapOf(catalog).get(code)

export interface OuraTagLandingDeps {
  ensureActivityType: (user: string, name: string, catalog: StoredActivityTypeCatalog) => Promise<boolean>
  findActivityTypeForName: (user: string, name: string) => Promise<string | null>
  resolveOrCreateActivityType: (user: string, name: string) => Promise<string>
}

/**
 * The type a tag lands on, and the field values it gets. A bare known code goes to its table type unless
 * the user already has a type the code resolves to; the values follow the type, so a mapped name that
 * resolves to the table type gets them too.
 */
export const resolveOuraTagLanding = async (
  deps: OuraTagLandingDeps,
  user: string,
  tag: Pick<OuraTagWithComment, 'tag' | 'tag_from_code' | 'tag_key'>,
  catalog: StoredActivityTypeCatalog,
): Promise<OuraTagTarget> => {
  const target = tag.tag_key ? ouraTagTarget(catalog, tag.tag_key) : undefined
  if (
    target &&
    tag.tag_from_code &&
    !(await deps.findActivityTypeForName(user, tag.tag)) &&
    (await deps.ensureActivityType(user, target.activity_type, catalog))
  ) {
    return target
  }
  const activity_type = await deps.resolveOrCreateActivityType(user, tag.tag)
  return { activity_type, data: target?.activity_type === activity_type ? target.data : undefined }
}
