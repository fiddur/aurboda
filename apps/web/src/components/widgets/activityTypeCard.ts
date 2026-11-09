import type { ActivityTypeCardConfig } from '@aurboda/api-spec'

import { formatMinutesAsHM } from '../charts/sleep-utils'

export type SpeedDisplay = NonNullable<ActivityTypeCardConfig['speed_display']>

/** Pace for the types timed per kilometre on foot, speed for the rest. */
export const speedDisplayFor = ({ pattern, speed_display }: ActivityTypeCardConfig): SpeedDisplay =>
  speed_display ?? (/run|walk|hik/.test(pattern) ? 'pace' : 'speed')

export const formatHoursMinutes = (minutes: number): string => formatMinutesAsHM(Math.round(minutes))

export const formatDistanceKm = (km: number): string => `${km.toFixed(1)} km`

export const formatPace = (secPerKm: number): string => {
  const total = Math.round(secPerKm)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')} /km`
}

export const formatSpeed = (kmh: number): string => `${kmh.toFixed(1)} km/h`
