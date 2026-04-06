import type { Router } from 'express'

import { typedRouter } from './typed-router.ts'

export interface OwnTracksDeps {
  loginToUserDb: (user: string, password: string) => Promise<void>
  insertPlace: (
    user: string,
    place: {
      externalId: string
      lat: number
      lon: number
      name: string
      radius: number
      source: 'owntracks'
    },
  ) => Promise<void>
  insertLocation: (
    user: string,
    location: {
      accuracy?: number
      altitude?: number
      lat: number
      lon: number
      regions?: string[]
      source: 'owntracks'
      time: Date
      velocity?: number
    },
  ) => Promise<void>
  onLocationInserted?: (user: string) => void
}

/**
 * Parse HTTP Basic authentication header.
 * Returns { username, password } if valid, undefined otherwise.
 */
export function parseBasicAuth(
  authHeader: string | undefined,
): { username: string; password: string } | undefined {
  if (!authHeader?.toLowerCase().startsWith('basic ')) {
    return undefined
  }

  try {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8')
    const colonIndex = decoded.indexOf(':')
    if (colonIndex === -1) return undefined

    return {
      password: decoded.slice(colonIndex + 1),
      username: decoded.slice(0, colonIndex),
    }
  } catch {
    return undefined
  }
}

/**
 * Create OwnTracks router with injected dependencies for testability.
 */
export function createOwnTracksRouter(deps: OwnTracksDeps): Router {
  const router = typedRouter()

  router.post<Record<string, string>, { error: string }>('/', async (req, res) => {
    const credentials = parseBasicAuth(req.headers.authorization)
    if (!credentials) {
      res.status(401).set('WWW-Authenticate', 'Basic realm="OwnTracks"').json({ error: 'Unauthorized' })
      return
    }

    const { username: user, password } = credentials

    try {
      // Authenticate using existing PostgreSQL user credentials
      await deps.loginToUserDb(user, password)

      const { _type: type } = req.body

      if (type === 'status') {
        // Status messages are informational, no storage needed
      } else if (type === 'waypoint') {
        const { lat, lon, desc, rad, rid } = req.body
        await deps.insertPlace(user, {
          externalId: rid,
          lat,
          lon,
          name: desc,
          radius: rad,
          source: 'owntracks',
        })
      } else if (type === 'location') {
        const { lat, lon, tst, inregions, acc, alt, vel } = req.body
        await deps.insertLocation(user, {
          accuracy: acc,
          altitude: alt,
          lat,
          lon,
          regions: inregions,
          source: 'owntracks',
          time: new Date(tst * 1000),
          velocity: vel,
        })
        // Trigger detection with debounce
        deps.onLocationInserted?.(user)
      }

      res.end(`[]`)
    } catch (error) {
      // Authentication failure or DB error
      if (error instanceof Error && error.message.includes('authentication failed')) {
        res
          .status(401)
          .set('WWW-Authenticate', 'Basic realm="OwnTracks"')
          .json({ error: 'Invalid credentials' })
        return
      }
      console.error('OwnTracks error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  return router as unknown as Router
}
