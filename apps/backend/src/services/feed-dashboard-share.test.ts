import type { DashboardConfig } from '@aurboda/api-spec'

import { describe, expect, test, vi } from 'vitest'

import {
  dashboardShareTags,
  type DashboardShareDeps,
  type DashboardShareSource,
  resolveDashboardShare,
} from './feed-dashboard-share.ts'

const config: DashboardConfig = {
  period: { granularity: 'month' },
  sections: [
    {
      id: 's1',
      title: 'Month',
      type: 'metrics',
      widgets: [
        { config: { metric: 'steps', title: 'Steps' }, id: 'w1', type: 'metric_card' },
        { config: { href: '/settings', label: 'Settings' }, id: 'w2', type: 'quick_link' },
      ],
    },
  ],
  version: 1,
}

const shared = { config, is_private: false, name: 'Month in data', slug: 'abc123' }

const DASHBOARD_ID = '00000000-0000-4000-8000-000000000001'

const body = (over: Partial<DashboardShareSource> = {}): DashboardShareSource => ({
  dashboard_id: DASHBOARD_ID,
  include_link: true,
  period: '2026-10',
  ...over,
})

const depsWith = (over: Partial<DashboardShareDeps> = {}): DashboardShareDeps => ({
  getHomeDashboard: vi.fn(async () => config),
  getSharedDashboardById: vi.fn(async () => shared),
  getUserTimezone: vi.fn(async () => 'Europe/Stockholm'),
  now: () => new Date('2026-11-08T12:00:00Z'),
  ...over,
})

const WEB = 'https://aurboda.example'

describe('resolveDashboardShare', () => {
  test('a published shared dashboard: its name, the period, a sanitized snapshot and its link', async () => {
    const deps = depsWith()
    const resolved = await resolveDashboardShare('fiddur', body(), WEB, deps)
    expect(deps.getSharedDashboardById).toHaveBeenCalledWith('fiddur', DASHBOARD_ID)
    expect(resolved).toEqual({
      dashboard: {
        config: {
          description: undefined,
          period: { granularity: 'month' },
          sections: [
            {
              id: 's1',
              title: 'Month',
              type: 'metrics',
              widgets: [
                { config: { metric: 'steps', title: 'Steps' }, id: 'w1', type: 'metric_card' },
                { config: { href: '#', label: 'Settings' }, id: 'w2', type: 'quick_link' },
              ],
            },
          ],
          version: 1,
        },
        dashboard_id: DASHBOARD_ID,
        include_link: true,
        name: 'Month in data',
        period: '2026-10',
        url: 'https://aurboda.example/u/fiddur/abc123',
      },
      ok: true,
    })
  })

  test('the home dashboard: named Home, no id and never a link', async () => {
    const deps = depsWith()
    const resolved = await resolveDashboardShare('fiddur', body({ dashboard_id: undefined }), WEB, deps)
    expect(deps.getHomeDashboard).toHaveBeenCalledWith('fiddur')
    expect(deps.getSharedDashboardById).not.toHaveBeenCalled()
    expect(resolved.ok && resolved.dashboard.name).toBe('Home')
    expect(resolved.ok && resolved.dashboard).not.toHaveProperty('dashboard_id')
    expect(resolved.ok && resolved.dashboard).not.toHaveProperty('url')
  })

  test('no link for a private dashboard, when not asked for, or without a web host', async () => {
    const privateDeps = depsWith({ getSharedDashboardById: async () => ({ ...shared, is_private: true }) })
    const unpublished = await resolveDashboardShare('fiddur', body(), WEB, privateDeps)
    expect(unpublished.ok && unpublished.dashboard).not.toHaveProperty('url')
    const unlinked = await resolveDashboardShare('fiddur', body({ include_link: false }), WEB, depsWith())
    expect(unlinked.ok && unlinked.dashboard).not.toHaveProperty('url')
    expect(unlinked.ok && unlinked.dashboard.include_link).toBe(false)
    const hostless = await resolveDashboardShare('fiddur', body(), undefined, depsWith())
    expect(hostless.ok && hostless.dashboard).not.toHaveProperty('url')
  })

  test('404 for an unknown dashboard', async () => {
    const deps = depsWith({ getSharedDashboardById: async () => null })
    expect(await resolveDashboardShare('fiddur', body(), WEB, deps)).toEqual({
      error: 'Dashboard not found',
      ok: false,
      status: 404,
    })
  })

  test('400 for a rolling dashboard', async () => {
    const { period: _period, ...rolling } = config
    const deps = depsWith({ getSharedDashboardById: async () => ({ ...shared, config: rolling }) })
    expect(await resolveDashboardShare('fiddur', body(), WEB, deps)).toEqual({
      error: 'Not a period dashboard',
      ok: false,
      status: 400,
    })
  })

  test("400 for a period of another granularity than the dashboard's", async () => {
    expect(await resolveDashboardShare('fiddur', body({ period: '2026-W44' }), WEB, depsWith())).toEqual({
      error: "period does not match the dashboard's granularity",
      ok: false,
      status: 400,
    })
  })

  test('400 for a period that has not finished in the owner timezone', async () => {
    const deps = depsWith({ now: () => new Date('2026-10-31T22:30:00Z') })
    expect(await resolveDashboardShare('fiddur', body(), WEB, deps)).toEqual({
      error: 'The period is not finished yet',
      ok: false,
      status: 400,
    })
    const utc = depsWith({ getUserTimezone: async () => 'UTC', now: () => new Date('2026-11-01T00:00:00Z') })
    expect((await resolveDashboardShare('fiddur', body(), WEB, utc)).ok).toBe(true)
  })

  test('400 for a period key that does not exist', async () => {
    expect(await resolveDashboardShare('fiddur', body({ period: '2027-W53' }), WEB, depsWith())).toEqual({
      error: 'Invalid period',
      ok: false,
      status: 400,
    })
  })
})

describe('dashboardShareTags', () => {
  const dashboard = {
    config,
    include_link: true,
    name: 'Month in data',
    period: '2026-10',
  }

  test("the default tags, the dashboard's name and typed tags", async () => {
    const tags = await dashboardShareTags(
      'fiddur',
      dashboard,
      { message: 'Good one #october' },
      async () => ({ feed_default_tags: ['aurboda'] }),
    )
    expect(tags).toEqual(['aurboda', 'monthindata', 'october'])
  })

  test('explicit tags replace the automatic ones', async () => {
    const tags = await dashboardShareTags('fiddur', dashboard, { tags: ['stats'] }, async () => ({}))
    expect(tags).toEqual(['stats'])
  })
})
