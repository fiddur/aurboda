/**
 * Integration tests for shared dashboards CRUD.
 *
 * Covers create (with unique slug generation), list (all + public-only),
 * lookup by id/slug, partial update, and delete — against a real PostgreSQL
 * instance via testcontainers.
 */
import type { DashboardConfig } from '@aurboda/api-spec'

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  createSharedDashboard,
  deleteSharedDashboard,
  getSharedDashboardById,
  getSharedDashboardBySlug,
  listPublicSharedDashboards,
  listSharedDashboards,
  updateSharedDashboard,
} from './shared-dashboards.ts'

const CONTAINER_TIMEOUT = 120_000

const sampleConfig = (title: string): DashboardConfig => ({
  sections: [
    {
      id: 'sec-1',
      title,
      type: 'metrics',
      widgets: [{ config: { metric: 'hrv_7day', title: 'HRV' }, id: 'w-1', type: 'metric_card' }],
    },
  ],
  version: 1,
})

describe('Shared dashboards integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('creates with a generated slug and round-trips by id and slug', async () => {
    const user = getTestUser()
    const created = await createSharedDashboard(user, {
      config: sampleConfig('Mine'),
      is_public: false,
      name: 'My dashboard',
    })

    expect(created.id).toBeTruthy()
    expect(created.slug).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(created.is_public).toBe(false)
    expect(created.config.sections[0].title).toBe('Mine')

    expect((await getSharedDashboardById(user, created.id))?.slug).toBe(created.slug)
    expect((await getSharedDashboardBySlug(user, created.slug))?.id).toBe(created.id)
    expect(await getSharedDashboardBySlug(user, 'does-not-exist')).toBeNull()
  })

  test('generates distinct slugs across dashboards', async () => {
    const user = getTestUser()
    const a = await createSharedDashboard(user, {
      config: sampleConfig('A'),
      is_public: false,
      name: 'A',
    })
    const b = await createSharedDashboard(user, {
      config: sampleConfig('B'),
      is_public: false,
      name: 'B',
    })
    expect(a.slug).not.toBe(b.slug)
  })

  test('lists all (newest first) and filters public-only', async () => {
    const user = getTestUser()
    await createSharedDashboard(user, { config: sampleConfig('p1'), is_public: true, name: 'Public 1' })
    await createSharedDashboard(user, { config: sampleConfig('u1'), is_public: false, name: 'Unlisted 1' })
    const pub2 = await createSharedDashboard(user, {
      config: sampleConfig('p2'),
      is_public: true,
      name: 'Public 2',
    })

    const all = await listSharedDashboards(user)
    expect(all.map((d) => d.name)).toEqual(['Public 2', 'Unlisted 1', 'Public 1'])

    const onlyPublic = await listPublicSharedDashboards(user)
    expect(onlyPublic.map((d) => d.name)).toEqual(['Public 2', 'Public 1'])
    expect(onlyPublic[0].id).toBe(pub2.id)
  })

  test('partially updates name, config, and visibility without changing the slug', async () => {
    const user = getTestUser()
    const created = await createSharedDashboard(user, {
      config: sampleConfig('before'),
      is_public: false,
      name: 'Before',
    })

    const updated = await updateSharedDashboard(user, created.id, {
      config: sampleConfig('after'),
      is_public: true,
      name: 'After',
    })

    expect(updated?.slug).toBe(created.slug)
    expect(updated?.name).toBe('After')
    expect(updated?.is_public).toBe(true)
    expect(updated?.config.sections[0].title).toBe('after')

    // A no-op patch returns the current record unchanged.
    const noop = await updateSharedDashboard(user, created.id, {})
    expect(noop?.name).toBe('After')

    expect(
      await updateSharedDashboard(user, '00000000-0000-0000-0000-000000000000', { name: 'x' }),
    ).toBeNull()
  })

  test('deletes a dashboard and reports missing ones', async () => {
    const user = getTestUser()
    const created = await createSharedDashboard(user, {
      config: sampleConfig('x'),
      is_public: true,
      name: 'X',
    })

    expect(await deleteSharedDashboard(user, created.id)).toBe(true)
    expect(await getSharedDashboardById(user, created.id)).toBeNull()
    expect(await getSharedDashboardBySlug(user, created.slug)).toBeNull()
    expect(await deleteSharedDashboard(user, created.id)).toBe(false)
  })
})
