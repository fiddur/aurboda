import type { HomeAssistantEntity } from '@aurboda/api-spec'

import type { Location } from '../../db/types.ts'

export interface HomeAssistantState {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
  last_changed?: string
  last_updated: string
}

const DAY_MS = 24 * 60 * 60 * 1000

const NO_ZONE_STATES = new Set(['', 'not_home', 'unknown', 'unavailable'])

/** The zone a state names, as `regions`: `home` is the Home zone, `not_home` and no-data states are none. */
export const zoneRegions = (state: string): string[] => {
  if (state === 'home') return ['Home']
  if (NO_ZONE_STATES.has(state)) return []
  return [state]
}

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const coordinates = (attributes: Record<string, unknown>): { lat: number; lon: number } | null => {
  const lat = finiteNumber(attributes.latitude)
  const lon = finiteNumber(attributes.longitude)
  if (lat === undefined || lon === undefined || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lat, lon }
}

export const stateToLocation = (state: HomeAssistantState): Location | null => {
  const position = coordinates(state.attributes)
  if (!position) return null
  const time = new Date(state.last_updated)
  if (Number.isNaN(time.getTime())) return null
  const speed = finiteNumber(state.attributes.speed)
  return {
    ...position,
    accuracy: finiteNumber(state.attributes.gps_accuracy),
    altitude: finiteNumber(state.attributes.altitude),
    regions: zoneRegions(state.state),
    source: 'home_assistant',
    time,
    // The column holds km/h, the unit OwnTracks' `vel` writes; HA reports m/s.
    // iOS reports -1 for "no speed".
    velocity: speed === undefined || speed < 0 ? undefined : speed * 3.6,
  }
}

const isTrackable = (state: HomeAssistantState): boolean =>
  (state.entity_id.startsWith('person.') || state.entity_id.startsWith('device_tracker.')) &&
  coordinates(state.attributes) !== null

export const trackableEntities = (states: HomeAssistantState[]): HomeAssistantEntity[] =>
  states
    .filter(isTrackable)
    .map((state) => ({
      entity_id: state.entity_id,
      name: typeof state.attributes.friendly_name === 'string' ? state.attributes.friendly_name : null,
      state: state.state,
    }))
    .sort((a, b) => {
      const aPerson = a.entity_id.startsWith('person.') ? 0 : 1
      const bPerson = b.entity_id.startsWith('person.') ? 0 : 1
      return aPerson - bPerson || a.entity_id.localeCompare(b.entity_id)
    })

/** Consecutive slices of at most 24 h covering `[start, end]`; empty when `start >= end`. */
export const historySlices = (start: Date, end: Date): { start: Date; end: Date }[] => {
  const slices: { start: Date; end: Date }[] = []
  for (let from = start.getTime(); from < end.getTime(); from += DAY_MS) {
    slices.push({ end: new Date(Math.min(from + DAY_MS, end.getTime())), start: new Date(from) })
  }
  return slices
}
