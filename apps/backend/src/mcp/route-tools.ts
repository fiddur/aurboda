import { mergeRoutesBodySchema, tzSchema, updateRouteBodySchema } from '@aurboda/api-spec'
import { z } from 'zod'

import { defaultRouteOps, type RouteOps } from '../services/routes.ts'
import { errorResponse, jsonResponse, type McpServer, tzJsonResponse } from './helpers.ts'

const routeId = z.string().uuid().describe('Route ID')

export const registerRouteTools = (server: McpServer, user: string, ops: RouteOps = defaultRouteOps) => {
  server.tool(
    'list_routes',
    'Recognised routes: courses run more than once, matched by GPS track (25 m buffer, 90 % coverage both ways, same direction, same activity type). Each has a name, activity type, length, run count and latest run, most recently run first.',
    { tz: tzSchema },
    async ({ tz }) => tzJsonResponse({ data: await ops.list(user), success: true }, tz),
  )

  server.tool(
    'get_route',
    "A route with its line and its runs over time, newest first: elapsed seconds, average heart rate and pace (s/km) per run, for following progress on the same course. Use query_activities with route_id for the runs' full activity data.",
    { id: routeId, tz: tzSchema },
    async ({ id, tz }) => {
      const detail = await ops.detail(user, id)
      return detail ? tzJsonResponse({ data: detail, success: true }, tz) : errorResponse('Route not found')
    },
  )

  server.tool(
    'update_route',
    'Rename a route.',
    { id: routeId, ...updateRouteBodySchema.shape },
    async ({ id, name }) => {
      const route = await ops.rename(user, id, name)
      return route ? jsonResponse({ data: route, success: true }) : errorResponse('Route not found')
    },
  )

  server.tool(
    'delete_route',
    'Delete a route. Its activities are kept and become unrouted (a later match_routes may pair them again).',
    { id: routeId },
    async ({ id }) =>
      (await ops.remove(user, id)) ? jsonResponse({ success: true }) : errorResponse('Route not found'),
  )

  server.tool(
    'merge_routes',
    'Merge one route into another: every run of source_route_id moves to the route `id`, and the source route is deleted.',
    { id: routeId.describe('Route to keep'), ...mergeRoutesBodySchema.shape },
    async ({ id, source_route_id }) => {
      const result = await ops.merge(user, id, source_route_id)
      return result ? jsonResponse({ data: result, success: true }) : errorResponse('Route not found')
    },
  )

  server.tool(
    'match_routes',
    'Match every tracked activity without a route: attach it to a covering route of its type, or pair it with another unrouted track and create a route from the older one. Incremental and idempotent; new tracks are matched automatically.',
    {},
    async () => jsonResponse({ data: await ops.match(user), success: true }),
  )
}
