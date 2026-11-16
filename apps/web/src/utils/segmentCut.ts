/** Inclusive indexes into a list of points: the stretch a segment cut covers. */
export interface IndexRange {
  from: number
  to: number
}

const EARTH_RADIUS_M = 6_371_000

const toRad = (deg: number): number => (deg * Math.PI) / 180

const haversineM = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): number => {
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** The first index whose value is at least `target` in a non-decreasing list (`values.length` when none). */
const lowerBound = (values: number[], target: number): number => {
  let lo = 0
  let hi = values.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (values[mid] < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** The first index whose value is greater than `target` in a non-decreasing list. */
const upperBound = (values: number[], target: number): number => {
  let lo = 0
  let hi = values.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (values[mid] <= target) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** The points of a non-decreasing list with values in `[start, end]`, or null when there are none. */
const rangeWithin = (values: number[], start: number, end: number): IndexRange | null => {
  const from = lowerBound(values, start)
  const to = upperBound(values, end) - 1
  return from <= to ? { from, to } : null
}

/** The points whose time offset (seconds, ascending) lies between `startS` and `endS`. */
export const indexRangeForOffsets = (offsetsS: number[], startS: number, endS: number): IndexRange | null =>
  rangeWithin(offsetsS, startS, endS)

/** Distance along the line to each point, in metres, starting at 0. */
export const cumulativeDistancesM = (points: { lat: number; lon: number }[]): number[] =>
  points.reduce<number[]>((acc, point, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + haversineM(points[i - 1], point))
    return acc
  }, [])

/**
 * The points spanning `startKm` to `endKm` along the line: the last point at or
 * before the start through the first at or after the end. A route line is
 * simplified, so a short stretch often has no point of its own inside it.
 */
export const indexRangeForKm = (distancesM: number[], startKm: number, endKm: number): IndexRange | null => {
  if (distancesM.length < 2 || endKm <= startKm) return null
  const from = Math.max(0, upperBound(distancesM, startKm * 1000) - 1)
  const to = Math.min(distancesM.length - 1, lowerBound(distancesM, endKm * 1000))
  return from < to ? { from, to } : null
}

/**
 * The line with a point at least every `stepM` metres. A simplified line (a straight street is
 * two points) otherwise has no points inside a km range, and `indexRangeForKm` would mark it whole.
 */
export const densifyLine = <P extends { lat: number; lon: number }>(points: P[], stepM = 10): P[] =>
  points.flatMap((point, i) => {
    if (i === 0) return [point]
    const prev = points[i - 1]
    const steps = Math.max(1, Math.ceil(haversineM(prev, point) / stepM))
    return Array.from({ length: steps }, (_, k) => {
      const f = (k + 1) / steps
      return k === steps - 1
        ? point
        : { ...point, lat: prev.lat + (point.lat - prev.lat) * f, lon: prev.lon + (point.lon - prev.lon) * f }
    })
  })

/** The length of a stretch along the line, in metres; 0 without a stretch. */
export const cutLengthM = (distancesM: number[], range: IndexRange | null): number =>
  range ? distancesM[range.to] - distancesM[range.from] : 0

/** Mirrors `MIN_SEGMENT_LENGTH_M` in apps/backend/src/services/segments.ts, which refuses shorter cuts. */
export const MIN_SEGMENT_LENGTH_M = 100

/** Why a cut of this length cannot be created, or null when it can. */
export const cutTooShortReason = (lengthM: number): string | null =>
  lengthM < MIN_SEGMENT_LENGTH_M ? `A segment must be at least ${MIN_SEGMENT_LENGTH_M} m long` : null

const MIN_CUT_GAP_S = 1

/**
 * Moves one end of a `[start, end]` window within `[min, max]`, keeping the ends
 * at least a second apart: the moved end stops at the other one.
 */
export const moveCutEdge = (
  cut: { start: number; end: number },
  edge: 'start' | 'end',
  value: number,
  bounds: { min: number; max: number },
): { start: number; end: number } => {
  const clamped = Math.min(bounds.max, Math.max(bounds.min, value))
  return edge === 'start'
    ? { ...cut, start: Math.max(bounds.min, Math.min(clamped, cut.end - MIN_CUT_GAP_S)) }
    : { ...cut, end: Math.min(bounds.max, Math.max(clamped, cut.start + MIN_CUT_GAP_S)) }
}

const MIN_CUT_SPAN_S = 2

/** The whole seconds a cut can range over on a track with these offsets, or null when it is too short to cut. */
export const cutBounds = (offsetsS: number[] | null): { min: number; max: number } | null => {
  if (!offsetsS || offsetsS.length < 2) return null
  const min = Math.ceil(offsetsS[0])
  const max = Math.floor(offsetsS[offsetsS.length - 1])
  return max - min >= MIN_CUT_SPAN_S ? { max, min } : null
}
