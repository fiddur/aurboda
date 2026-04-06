import type { RequestHandler, Router } from 'express'

/**
 * Locations route group.
 *
 * Handles: /locations/*
 */
import {
  type AddNamedLocationBody,
  addNamedLocationBodySchema,
  type AddNamedLocationResponse,
  type DeleteTagResponse,
  type DetectedLocationsQuery,
  detectedLocationsQuerySchema,
  type DetectedLocationsResponse,
  type LocationsQuery,
  locationsQuerySchema,
  type LocationsResponse,
  type NamedLocationsResponse,
  type PromoteDetectedLocationBody,
  promoteDetectedLocationBodySchema,
  type UpdateNamedLocationBody,
  updateNamedLocationBodySchema,
} from '@aurboda/api-spec'

import { getDetectedLocations as getStoredDetectedLocations } from '../db/index.ts'
import {
  deleteNamedLocation,
  getDetectedLocations,
  getNamedLocations,
  insertNamedLocation,
  updateNamedLocation,
} from '../services/locations.ts'
import { queryLocations } from '../services/queries.ts'
import { typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery } from '../validation.ts'

export const createLocationsRouter = (authMiddleware: RequestHandler): Router => {
  const router = typedRouter()

  // GET /locations - Query location data for a time range
  router.get<Record<string, string>, LocationsResponse, unknown, LocationsQuery>(
    '/',
    authMiddleware,
    validateQuery(locationsQuerySchema),
    async (req, res) => {
      const { start, end } = req.query
      const user = req.user!

      const places = await queryLocations(user, new Date(start), new Date(end))
      res.json({ data: places, success: true })
    },
  )

  // GET /locations/named - List all named locations
  router.get<Record<string, string>, NamedLocationsResponse>('/named', authMiddleware, async (req, res) => {
    const locations = await getNamedLocations(req.user!)
    res.json({ data: locations, success: true })
  })

  // POST /locations/named - Create a named location
  router.post<Record<string, string>, AddNamedLocationResponse, AddNamedLocationBody>(
    '/named',
    authMiddleware,
    validateBody(addNamedLocationBodySchema),
    async (req, res) => {
      const { name, lat, lon, radius } = req.body
      const user = req.user!

      const location = await insertNamedLocation(user, { lat, lon, name, radius })
      res.json({ data: location, success: true })
    },
  )

  // PATCH /locations/named/:id - Update a named location
  router.patch<{ id: string }, AddNamedLocationResponse, UpdateNamedLocationBody>(
    '/named/:id',
    authMiddleware,
    validateBody(updateNamedLocationBodySchema),
    async (req, res) => {
      const { id } = req.params
      const { name, lat, lon, radius } = req.body
      const user = req.user!

      // lat and lon must be updated together
      if ((lat !== undefined) !== (lon !== undefined)) {
        return res.status(400).json({ error: 'lat and lon must be updated together', success: false })
      }

      const location = await updateNamedLocation(user, id, { lat, lon, name, radius })
      if (!location) {
        return res.status(404).json({ error: 'Named location not found', success: false })
      }
      res.json({ data: location, success: true })
    },
  )

  // DELETE /locations/named/:id - Delete a named location
  router.delete<{ id: string }, DeleteTagResponse>('/named/:id', authMiddleware, async (req, res) => {
    const { id } = req.params
    const deleted = await deleteNamedLocation(req.user!, id)
    if (!deleted) {
      return res.status(404).json({ error: 'Named location not found', success: false })
    }
    res.json({ success: true })
  })

  // GET /locations/detected - Get computed detected location clusters
  router.get<Record<string, string>, DetectedLocationsResponse, unknown, DetectedLocationsQuery>(
    '/detected',
    authMiddleware,
    validateQuery(detectedLocationsQuerySchema),
    async (req, res) => {
      const { start, end, min_duration } = req.query
      const user = req.user!

      const detected = await getDetectedLocations(user, {
        end: new Date(end),
        minDurationMinutes: min_duration ? parseInt(min_duration, 10) : undefined,
        start: new Date(start),
      })
      const serialized = detected.map((d) => ({
        first_visit: d.firstVisit,
        last_visit: d.lastVisit,
        lat: d.lat,
        lon: d.lon,
        suggested_radius: d.suggestedRadius,
        total_minutes: d.totalMinutes,
        visit_count: d.visitCount,
      }))
      res.json({ data: serialized, success: true })
    },
  )

  // GET /locations/detected/stored - Get stored detected locations with addresses
  router.get<Record<string, string>, DetectedLocationsResponse>(
    '/detected/stored',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const detected = await getStoredDetectedLocations(user)
      // Transform Date objects to ISO strings for API response
      const serialized = detected.map((d) => ({
        ...d,
        first_visit: d.first_visit.toISOString(),
        last_visit: d.last_visit.toISOString(),
      }))
      res.json({ data: serialized, success: true })
    },
  )

  // POST /locations/detected/promote - Promote detected location to named
  router.post<Record<string, string>, AddNamedLocationResponse, PromoteDetectedLocationBody>(
    '/detected/promote',
    authMiddleware,
    validateBody(promoteDetectedLocationBodySchema),
    async (req, res) => {
      const { lat, lon, name, radius } = req.body
      const user = req.user!

      const location = await insertNamedLocation(user, { lat, lon, name, radius })
      res.json({ data: location, success: true })
    },
  )

  return router as unknown as Router
}
