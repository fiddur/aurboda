import type { StoredActivityTypeCatalog, StoredActivityTypeCatalogEntry } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { loadActivityTypeCatalog } from '../../services/activity-type-catalog.ts'
import { type OuraTagLandingDeps, ouraTagTarget, resolveOuraTagLanding } from './tag-targets.ts'

const entry = (
  overrides: Partial<StoredActivityTypeCatalogEntry> & Pick<StoredActivityTypeCatalogEntry, 'name'>,
): StoredActivityTypeCatalogEntry => ({
  aliases: [],
  color: '#123456',
  display_category: 'other',
  display_name: overrides.name,
  group: 'intake',
  icon: '•',
  same_as: {},
  ...overrides,
})

const catalog: StoredActivityTypeCatalog = {
  entries: [
    entry({
      name: 'alcohol',
      oura_codes: ['tag_sleep_alcohol'],
      variants: [
        {
          aliases: [],
          data: { kind: 'beer' },
          display_name: 'Beer',
          name: 'beer',
          oura_codes: ['tag_generic_beer'],
        },
      ],
    }),
    entry({ name: 'sauna', oura_codes: ['tag_sleep_sauna'] }),
  ],
  groups: [{ key: 'intake', name: 'Intake' }],
  version: 'test',
}

describe('ouraTagTarget', () => {
  test('an entry code is the entry', () => {
    expect(ouraTagTarget(catalog, 'tag_sleep_alcohol')).toEqual({ activity_type: 'alcohol' })
  })

  test('a variant code is the entry with the variant data', () => {
    expect(ouraTagTarget(catalog, 'tag_generic_beer')).toEqual({
      activity_type: 'alcohol',
      data: { kind: 'beer' },
    })
  })

  test('a built-in code outside the catalogue is its built-in type', () => {
    expect(ouraTagTarget(catalog, 'tag_generic_nap')).toEqual({ activity_type: 'nap' })
  })

  test('an unknown code is undefined', () => {
    expect(ouraTagTarget(catalog, 'tag_generic_unheard_of')).toBeUndefined()
  })

  test('the shipped catalogue sends beer to alcohol and nap to nap', () => {
    const shipped = loadActivityTypeCatalog()
    expect(ouraTagTarget(shipped, 'tag_generic_beer')).toEqual({
      activity_type: 'alcohol',
      data: { kind: 'beer' },
    })
    expect(ouraTagTarget(shipped, 'tag_generic_nap')).toEqual({ activity_type: 'nap' })
  })
})

describe('resolveOuraTagLanding', () => {
  const fakeDeps = (types: Record<string, string>, resolvesTo: Record<string, string> = {}) => {
    const calls = { ensured: [] as string[], resolved: [] as string[] }
    const deps: OuraTagLandingDeps = {
      ensureActivityType: async (_user, name) => {
        calls.ensured.push(name)
        return true
      },
      findActivityTypeForName: async (_user, name) => types[name] ?? null,
      resolveOrCreateActivityType: async (_user, name) => {
        calls.resolved.push(name)
        return resolvesTo[name] ?? types[name] ?? name
      },
    }
    return { calls, deps }
  }

  test('a bare known code with no old type lands on the target with its data', async () => {
    const { calls, deps } = fakeDeps({})
    const landing = await resolveOuraTagLanding(
      deps,
      'user',
      { tag: 'tag_generic_beer', tag_from_code: true, tag_key: 'tag_generic_beer' },
      catalog,
    )
    expect(landing).toEqual({ activity_type: 'alcohol', data: { kind: 'beer' } })
    expect(calls.ensured).toEqual(['alcohol'])
    expect(calls.resolved).toEqual([])
  })

  test('a bare known code with an old type named after the code stays on it, without data', async () => {
    const { calls, deps } = fakeDeps({ tag_generic_beer: 'tag_generic_beer' })
    const landing = await resolveOuraTagLanding(
      deps,
      'user',
      { tag: 'tag_generic_beer', tag_from_code: true, tag_key: 'tag_generic_beer' },
      catalog,
    )
    expect(landing).toEqual({ activity_type: 'tag_generic_beer', data: undefined })
    expect(calls.ensured).toEqual([])
  })

  test('a mapped name that resolves to the target type gets the data', async () => {
    const { deps } = fakeDeps({}, { Beer: 'alcohol' })
    const landing = await resolveOuraTagLanding(
      deps,
      'user',
      { tag: 'Beer', tag_key: 'tag_generic_beer' },
      catalog,
    )
    expect(landing).toEqual({ activity_type: 'alcohol', data: { kind: 'beer' } })
  })

  test('a mapped name that resolves elsewhere gets no data', async () => {
    const { calls, deps } = fakeDeps({}, { Beer: 'beer' })
    const landing = await resolveOuraTagLanding(
      deps,
      'user',
      { tag: 'Beer', tag_key: 'tag_generic_beer' },
      catalog,
    )
    expect(landing).toEqual({ activity_type: 'beer', data: undefined })
    expect(calls.ensured).toEqual([])
  })

  test('an unknown code resolves as before', async () => {
    const { calls, deps } = fakeDeps({})
    const landing = await resolveOuraTagLanding(
      deps,
      'user',
      { tag: 'tag_generic_unheard_of', tag_from_code: true, tag_key: 'tag_generic_unheard_of' },
      catalog,
    )
    expect(landing).toEqual({ activity_type: 'tag_generic_unheard_of', data: undefined })
    expect(calls.resolved).toEqual(['tag_generic_unheard_of'])
    expect(calls.ensured).toEqual([])
  })

  test('a tag with no code resolves as before', async () => {
    const { calls, deps } = fakeDeps({})
    const landing = await resolveOuraTagLanding(deps, 'user', { tag: 'Evening swim' }, catalog)
    expect(landing).toEqual({ activity_type: 'Evening swim', data: undefined })
    expect(calls.resolved).toEqual(['Evening swim'])
  })
})
