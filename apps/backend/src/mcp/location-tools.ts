/**
 * MCP location management tools.
 */
import { latWithValidationSchema, lonWithValidationSchema } from '@aurboda/api-spec'
import { z } from 'zod'
import { getDetectedLocations as getStoredDetectedLocations } from '../db'
import {
  deleteNamedLocation,
  getDetectedLocations,
  getNamedLocations,
  insertNamedLocation,
  updateNamedLocation,
} from '../services/locations'
import { errorResponse, jsonResponse, type McpServer, mcpTimeRangeSchema } from './helpers'

// eslint-disable-next-line max-lines-per-function -- tool registrations are inherently long
export const registerLocationTools = (server: McpServer, user: string) => {
  // Tool: get_named_locations
  server.tool(
    'get_named_locations',
    'List all named locations. These are user-defined places with names and coordinates.',
    {},
    async () => {
      const locations = await getNamedLocations(user)
      return jsonResponse({ data: locations, success: true })
    },
  )

  // Tool: get_detected_locations
  server.tool(
    'get_detected_locations',
    'Get frequently visited locations that are not yet named. Detects places where user spent 60+ minutes. Returns coordinates, visit count, and total time spent.',
    {
      ...mcpTimeRangeSchema,
      min_duration: z.number().optional().describe('Minimum stay duration in minutes. Defaults to 60.'),
    },
    async ({ end, min_duration, start }) => {
      const detected = await getDetectedLocations(user, {
        end: new Date(end),
        minDurationMinutes: min_duration,
        start: new Date(start),
      })

      return jsonResponse({ data: detected, success: true })
    },
  )

  // Tool: get_stored_detected_locations
  server.tool(
    'get_stored_detected_locations',
    'Get stored detected locations with geocoded addresses. These are locations that have been previously detected and stored in the database.',
    {},
    async () => {
      const detected = await getStoredDetectedLocations(user)
      return jsonResponse({ data: detected, success: true })
    },
  )

  // Tool: add_named_location
  server.tool(
    'add_named_location',
    'Create a named location. Use this to save a frequently visited place with a name.',
    {
      lat: latWithValidationSchema.describe('Latitude of the location (-90 to 90)'),
      lon: lonWithValidationSchema.describe('Longitude of the location (-180 to 180)'),
      name: z.string().describe('Name for the location (e.g., "Home", "Office", "Gym")'),
      radius: z.number().optional().describe('Radius in meters. Defaults to 200.'),
    },
    async ({ lat, lon, name, radius }) => {
      const location = await insertNamedLocation(user, { lat, lon, name, radius })
      return jsonResponse({ data: location, success: true })
    },
  )

  // Tool: update_named_location
  server.tool(
    'update_named_location',
    'Update an existing named location. Can change name, coordinates, or radius.',
    {
      id: z.string().describe('The ID of the named location to update'),
      lat: z.number().optional().describe('New latitude (-90 to 90). Must be provided with lon.'),
      lon: z.number().optional().describe('New longitude (-180 to 180). Must be provided with lat.'),
      name: z.string().optional().describe('New name for the location'),
      radius: z.number().optional().describe('New radius in meters'),
    },
    async ({ id, lat, lon, name, radius }) => {
      if ((lat !== undefined && lon === undefined) || (lon !== undefined && lat === undefined)) {
        return errorResponse('lat and lon must be provided together.')
      }

      if (lat !== undefined && (lat < -90 || lat > 90)) {
        return errorResponse('Invalid latitude. Must be between -90 and 90.')
      }
      if (lon !== undefined && (lon < -180 || lon > 180)) {
        return errorResponse('Invalid longitude. Must be between -180 and 180.')
      }

      const location = await updateNamedLocation(user, id, { lat, lon, name, radius })
      if (!location) {
        return jsonResponse({ error: 'Named location not found', success: false })
      }
      return jsonResponse({ data: location, success: true })
    },
  )

  // Tool: delete_named_location
  server.tool(
    'delete_named_location',
    'Delete a named location by its ID.',
    {
      id: z.string().describe('The ID of the named location to delete'),
    },
    async ({ id }) => {
      const deleted = await deleteNamedLocation(user, id)
      if (!deleted) {
        return jsonResponse({ error: 'Named location not found', success: false })
      }
      return jsonResponse({ success: true })
    },
  )

  // Tool: promote_detected_location
  server.tool(
    'promote_detected_location',
    'Create a named location from detected coordinates. Use after get_detected_locations to save a frequently visited place.',
    {
      lat: latWithValidationSchema.describe('Latitude from detected location'),
      lon: lonWithValidationSchema.describe('Longitude from detected location'),
      name: z.string().describe('Name for the location'),
      radius: z.number().optional().describe('Radius in meters. Uses suggested radius if not provided.'),
    },
    async ({ lat, lon, name, radius }) => {
      const location = await insertNamedLocation(user, { lat, lon, name, radius })
      return jsonResponse({ data: location, success: true })
    },
  )
}
