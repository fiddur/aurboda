/**
 * CRUD for the user's published dashboards (the same capability as the
 * `/shared-dashboards` REST endpoints), and the resolved widget data of the
 * home dashboard or a shared one (`/dashboard/data`, `/shared-dashboards/:id/data`).
 * Public viewing is web-only and has no MCP tool. Responses include the `slug`
 * so a URL can be constructed; the absolute share URL is provided by the REST layer.
 */
import {
  createSharedDashboardBodySchema,
  dashboardDataQuerySchema,
  defaultDashboardConfig,
  tzSchema,
  updateSharedDashboardBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import type { SharedDashboardRecord } from '../db/index.ts'

import {
  createSharedDashboard,
  deleteSharedDashboard,
  getSharedDashboardById,
  listSharedDashboards,
  updateSharedDashboard,
} from '../db/index.ts'
import { resolvePresetConfig } from '../services/dashboard-presets.ts'
import {
  defaultPeriodLock,
  requestedPeriodLock,
  resolveLockUpdate,
  validatePeriodLock,
} from '../services/period-lock.ts'
import { PeriodError } from '../services/periods.ts'
import { getSettings, getUserTimezone } from '../services/settings.ts'
import { resolveDashboardView } from '../services/shared-dashboard-data.ts'
import { dashboardVisibilityOf, dashboardVisibilityToFlags } from '../services/visibility.ts'
import { errorResponse, jsonResponse, type McpServer, tzJsonResponse } from './helpers.ts'

const serialize = (record: SharedDashboardRecord) => ({
  config: record.config,
  created_at: record.created_at.toISOString(),
  id: record.id,
  name: record.name,
  period_fixed: record.period_fixed,
  period_from: record.period_from,
  period_lock: record.period_lock,
  slug: record.slug,
  updated_at: record.updated_at.toISOString(),
  visibility: dashboardVisibilityOf(record),
})

const periodLockHelp =
  'On a period dashboard, period_lock sets what visitors of the published dashboard see: "latest" (default) the most recently finished period, with no stepping; "fixed" the one period in period_fixed; "browsable" every finished period from period_from on (this exposes all of that history, so only set it when the user means to). period_fixed and period_from are period keys of the dashboard granularity (2026-10, 2026-W44 or 2026). A rolling dashboard keeps "latest".'

export const registerSharedDashboardTools = (server: McpServer, user: string) => {
  server.tool(
    'list_shared_dashboards',
    'List the user’s shared dashboards (published, independently-editable copies of a dashboard config). Includes the slug, name, visibility, period lock (period_lock, period_fixed, period_from) and config for each.',
    {},
    async () => {
      const records = await listSharedDashboards(user)
      return jsonResponse(records.map(serialize))
    },
  )

  server.tool(
    'create_shared_dashboard',
    `Create a dashboard from either a dashboard config or a preset ("blank", "home" = a copy of the home dashboard, "month_in_data" = a monthly period dashboard). Visibility "private" (default) keeps it to the user; "unlisted" makes it reachable via its slug; "public" also lists it on the public profile. ${periodLockHelp}`,
    { ...createSharedDashboardBodySchema.shape },
    async (params) => {
      const config = await resolvePresetConfig(user, params)
      if (!config) return errorResponse('Give exactly one of config or preset')
      const lock = requestedPeriodLock(params) ?? defaultPeriodLock
      const lockError = validatePeriodLock(config, lock, new Date(), await getUserTimezone(user))
      if (lockError !== null) return errorResponse(lockError)
      const record = await createSharedDashboard(user, {
        config,
        ...dashboardVisibilityToFlags(params.visibility),
        ...lock,
        name: params.name,
      })
      return jsonResponse(serialize(record))
    },
  )

  server.tool(
    'update_shared_dashboard',
    `Update a shared dashboard’s name, config, visibility (private, unlisted or public) and/or period lock. The slug never changes. Only provided fields are modified; period_fixed and period_from count only together with period_lock. ${periodLockHelp}`,
    { id: z.string().uuid().describe('The shared dashboard ID'), ...updateSharedDashboardBodySchema.shape },
    async ({ config, id, name, period_fixed, period_from, period_lock, visibility }) => {
      const stored = await getSharedDashboardById(user, id)
      if (!stored) return errorResponse('Shared dashboard not found')
      const lockUpdate = resolveLockUpdate(
        stored,
        { config, period_fixed, period_from, period_lock },
        new Date(),
        await getUserTimezone(user),
      )
      if ('error' in lockUpdate) return errorResponse(lockUpdate.error)
      const record = await updateSharedDashboard(user, id, {
        config,
        ...(visibility === undefined ? {} : dashboardVisibilityToFlags(visibility)),
        ...lockUpdate.lock,
        name,
      })
      if (!record) return errorResponse('Shared dashboard not found')
      return jsonResponse(serialize(record))
    },
  )

  server.tool(
    'get_dashboard_data',
    'Get the data each widget of a dashboard renders, keyed by widget id: the home dashboard, or a shared dashboard by dashboard_id. A rolling dashboard answers each widget over its own lookback ending now, or, for a chart widget with a fixed `since` date, from that date to now (period and window are null). A calendar-period dashboard (config.period set) answers the latest finished period unless `period` is given (2026-10, 2026-W44 or 2026; it must be finished and match the granularity), with each figure compared against the previous period (previous_value, previous_* fields, trend_percent).',
    {
      dashboard_id: z
        .string()
        .uuid()
        .optional()
        .describe('A shared dashboard ID; the home dashboard when omitted'),
      ...dashboardDataQuerySchema.shape,
      tz: tzSchema,
    },
    async ({ dashboard_id, period, tz }) => {
      const config =
        dashboard_id === undefined
          ? ((await getSettings(user)).dashboard ?? defaultDashboardConfig)
          : (await getSharedDashboardById(user, dashboard_id))?.config
      if (!config) return errorResponse('Shared dashboard not found')
      try {
        return tzJsonResponse(await resolveDashboardView(user, config, period), tz)
      } catch (error) {
        if (error instanceof PeriodError) return errorResponse(error.message)
        throw error
      }
    },
  )

  server.tool(
    'delete_shared_dashboard',
    'Delete a shared dashboard by ID. Its slug stops resolving immediately.',
    { id: z.string().uuid().describe('The shared dashboard ID') },
    async ({ id }) => {
      const existing = await getSharedDashboardById(user, id)
      if (!existing) return errorResponse('Shared dashboard not found')
      await deleteSharedDashboard(user, id)
      return jsonResponse({ deleted: true, id })
    },
  )
}
