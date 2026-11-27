export const SYNODIC_MONTH_DAYS = 29.530588853

const REFERENCE_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14)
const DAY_MS = 86_400_000
const PHASE_EMOJI = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'] as const

export type MoonValue = 'age_days' | 'age_percent' | 'illumination'

export interface MoonPhase {
  age_days: number
  age_percent: number
  emoji: string
  illumination: number
}

/** The moon on calendar day `date` (YYYY-MM-DD), evaluated at 12:00 UTC. */
export const moonPhase = (date: string): MoonPhase => {
  const days = (Date.parse(`${date}T12:00:00Z`) - REFERENCE_NEW_MOON_MS) / DAY_MS
  const cycles = days / SYNODIC_MONTH_DAYS
  const fraction = cycles - Math.floor(cycles)
  return {
    age_days: fraction * SYNODIC_MONTH_DAYS,
    age_percent: fraction * 100,
    emoji: PHASE_EMOJI[Math.floor(fraction * 8 + 0.5) % 8],
    illumination: ((1 - Math.cos(2 * Math.PI * fraction)) / 2) * 100,
  }
}
