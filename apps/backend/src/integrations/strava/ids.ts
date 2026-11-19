/**
 * Strava activity and athlete ids are 64-bit integers, which a JS number cannot hold exactly
 * past 2^53 - 1. They are handled as exact decimal strings.
 */

const INTEGER_LITERAL = /^-?\d+$/
const STRAVA_ID = /^[1-9]\d{0,19}$/

/** Keeps an integer literal that is not a safe integer as its exact source text. */
export const losslessIntegerReviver = (
  _key: string,
  value: unknown,
  context?: { source?: string },
): unknown => {
  const source = context?.source
  if (typeof value === 'number' && !Number.isSafeInteger(value) && source && INTEGER_LITERAL.test(source)) {
    return source
  }
  return value
}

export const parseStravaJson = (text: string): unknown => JSON.parse(text, losslessIntegerReviver)

/** The exact decimal id, or null when the value is not a positive integer id. */
export const toStravaId = (value: unknown): string | null => {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : null
  if (typeof value === 'string') return STRAVA_ID.test(value) ? value : null
  return null
}

/** Prefers `id_str`, as Strava recommends, over the (losslessly parsed) `id`. */
export const stravaIdOf = (object: { id: number | string; id_str?: string }): string => {
  const id = toStravaId(object.id_str) ?? toStravaId(object.id)
  if (id === null) throw new Error('Strava object has no usable id')
  return id
}
