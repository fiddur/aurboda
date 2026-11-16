import type { LatLon } from '../db/routes.ts'

export type Xy = [number, number]

export interface DensePoint {
  x: number
  y: number
  /** Metres from the start of the line. */
  d: number
}

export interface Interval {
  from_m: number
  to_m: number
}

export interface ActivityInterval extends Interval {
  activity_id: string
}

export interface Stretch extends Interval {
  activity_ids: string[]
}

const EARTH_RADIUS_M = 6_371_008.8
const DEG = Math.PI / 180
const GRID_CELL_M = 50

/** Equirectangular metres around `origin`: well under a metre off over a few km. */
export const toLocalMetres = (points: LatLon[], origin: LatLon): Xy[] => {
  const kx = Math.cos(origin.lat * DEG) * EARTH_RADIUS_M * DEG
  const ky = EARTH_RADIUS_M * DEG
  return points.map((p) => [(p.lon - origin.lon) * kx, (p.lat - origin.lat) * ky])
}

const fromLocalMetres = ([x, y]: Xy, origin: LatLon): LatLon => {
  const kx = Math.cos(origin.lat * DEG) * EARTH_RADIUS_M * DEG
  const ky = EARTH_RADIUS_M * DEG
  return { lat: origin.lat + y / ky, lon: origin.lon + x / kx }
}

/** The line with a point at least every `maxStepM`, each carrying its distance from the start. */
export const densify = (points: Xy[], maxStepM = 15): DensePoint[] => {
  if (points.length === 0) return []
  const first = points[0]!
  const out: DensePoint[] = [{ d: 0, x: first[0], y: first[1] }]
  let d = 0
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]!
    const [bx, by] = points[i]!
    const len = Math.hypot(bx - ax, by - ay)
    if (len === 0) continue
    const steps = Math.ceil(len / maxStepM)
    for (let k = 1; k <= steps; k++) {
      const f = k / steps
      out.push({ d: d + len * f, x: ax + (bx - ax) * f, y: ay + (by - ay) * f })
    }
    d += len
  }
  return out
}

interface Edge {
  ax: number
  ay: number
  dx: number
  dy: number
  len2: number
}

const cellKey = (cx: number, cy: number): string => `${cx},${cy}`

const edgeGrid = (line: Xy[]): Map<string, Edge[]> => {
  const grid = new Map<string, Edge[]>()
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1]!
    const [bx, by] = line[i]!
    const edge = { ax, ay, dx: bx - ax, dy: by - ay, len2: (bx - ax) ** 2 + (by - ay) ** 2 }
    if (edge.len2 === 0) continue
    const x0 = Math.floor(Math.min(ax, bx) / GRID_CELL_M)
    const x1 = Math.floor(Math.max(ax, bx) / GRID_CELL_M)
    const y0 = Math.floor(Math.min(ay, by) / GRID_CELL_M)
    const y1 = Math.floor(Math.max(ay, by) / GRID_CELL_M)
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = cellKey(cx, cy)
        const cell = grid.get(key)
        if (cell) cell.push(edge)
        else grid.set(key, [edge])
      }
    }
  }
  return grid
}

const distanceToEdge2 = (x: number, y: number, e: Edge): number => {
  const u = Math.min(1, Math.max(0, ((x - e.ax) * e.dx + (y - e.ay) * e.dy) / e.len2))
  return (x - (e.ax + e.dx * u)) ** 2 + (y - (e.ay + e.dy * u)) ** 2
}

/** Whether some edge within `nearM` of the point heads the same way as `heading`. */
const nearSameWay = (
  grid: Map<string, Edge[]>,
  p: DensePoint,
  heading: Xy,
  nearM: number,
  reach: number,
): boolean => {
  const cx = Math.floor(p.x / GRID_CELL_M)
  const cy = Math.floor(p.y / GRID_CELL_M)
  const near2 = nearM * nearM
  for (let ix = cx - reach; ix <= cx + reach; ix++) {
    for (let iy = cy - reach; iy <= cy + reach; iy++) {
      for (const e of grid.get(cellKey(ix, iy)) ?? []) {
        if (heading[0] * e.dx + heading[1] * e.dy > 0 && distanceToEdge2(p.x, p.y, e) <= near2) return true
      }
    }
  }
  return false
}

const headingAt = (dense: DensePoint[], i: number): Xy => {
  const prev = dense[Math.max(0, i - 1)]!
  const next = dense[Math.min(dense.length - 1, i + 1)]!
  return [next.x - prev.x, next.y - prev.y]
}

/** Each point of the densified line A: whether B runs near it in the same direction. */
const nearFlags = (dense: DensePoint[], b: Xy[], nearM: number): boolean[] => {
  const grid = edgeGrid(b)
  const reach = Math.ceil(nearM / GRID_CELL_M)
  return dense.map((p, i) => nearSameWay(grid, p, headingAt(dense, i), nearM, reach))
}

/** Runs of near points, bridging non-near stretches of up to `maxGapM`, dropping those shorter than `minLengthM`. */
const runsFromFlags = (
  dense: DensePoint[],
  flags: boolean[],
  { maxGapM, minLengthM }: { maxGapM: number; minLengthM: number },
): Interval[] => {
  const runs: Interval[] = []
  let current: Interval | null = null
  let gapStart: number | null = null
  dense.forEach((p, i) => {
    if (flags[i]) {
      if (current && gapStart !== null && dense[i - 1]!.d - gapStart > maxGapM) {
        runs.push(current)
        current = null
      }
      if (current) current.to_m = p.d
      else current = { from_m: p.d, to_m: p.d }
      gapStart = null
    } else if (current && gapStart === null) {
      gapStart = p.d
    }
  })
  if (current) runs.push(current)
  return runs.filter((r) => r.to_m - r.from_m >= minLengthM)
}

export interface SharedRunOptions {
  nearM?: number
  maxGapM?: number
  minLengthM?: number
  maxStepM?: number
}

/**
 * The intervals of A (metres along it) along which B runs near it in the same direction:
 * a densified point of A is near when an edge of B within `nearM` points the same way
 * (a positive dot product with A's local heading), so a reversed B never matches and an
 * out-and-back B only on its leg in A's direction.
 */
export const sharedRuns = (
  a: LatLon[],
  b: LatLon[],
  { nearM = 20, maxGapM = 40, minLengthM = 400, maxStepM = 15 }: SharedRunOptions = {},
): Interval[] => {
  const origin = a[0]
  if (!origin || a.length < 2 || b.length < 2) return []
  const dense = densify(toLocalMetres(a, origin), maxStepM)
  return runsFromFlags(dense, nearFlags(dense, toLocalMetres(b, origin), nearM), { maxGapM, minLengthM })
}

/**
 * One row per session: the Garmin and Strava rows of one run overlap in time and count once
 * (the first by start time, then id, is kept).
 */
export const distinctSessions = <T extends { activity_id: string; start_time: Date; end_time: Date }>(
  candidates: T[],
): T[] => {
  const sorted = candidates.toSorted(
    (x, y) => x.start_time.getTime() - y.start_time.getTime() || x.activity_id.localeCompare(y.activity_id),
  )
  const kept: T[] = []
  for (const c of sorted) {
    const overlaps = kept.some((k) => k.start_time < c.end_time && c.start_time < k.end_time)
    if (!overlaps) kept.push(c)
  }
  return kept
}

const length = (i: Interval): number => i.to_m - i.from_m

const overlapM = (x: Interval, y: Interval): number =>
  Math.max(0, Math.min(x.to_m, y.to_m) - Math.max(x.from_m, y.from_m))

const mutualOverlap = (x: Interval, y: Interval): number => {
  const longer = Math.max(length(x), length(y))
  return longer > 0 ? overlapM(x, y) / longer : 0
}

/** The union of a supporter's intervals clipped to `within`. */
const clippedUnion = (intervals: Interval[], within: Interval): Interval[] => {
  const clipped = intervals
    .map((i) => ({ from_m: Math.max(i.from_m, within.from_m), to_m: Math.min(i.to_m, within.to_m) }))
    .filter((i) => i.to_m > i.from_m)
    .toSorted((x, y) => x.from_m - y.from_m)
  const merged: Interval[] = []
  for (const i of clipped) {
    const last = merged.at(-1)
    if (last && i.from_m <= last.to_m) last.to_m = Math.max(last.to_m, i.to_m)
    else merged.push({ ...i })
  }
  return merged
}

/** The longest contiguous part of `within` covered by at least `needed` of the per-supporter interval sets. */
const longestCovered = (perSupporter: Interval[][], within: Interval, needed: number): Interval | null => {
  const events: [number, number][] = []
  for (const set of perSupporter) {
    for (const i of clippedUnion(set, within)) events.push([i.from_m, 1], [i.to_m, -1])
  }
  events.sort((x, y) => x[0] - y[0] || x[1] - y[1])
  let count = 0
  let start: number | null = null
  let best: Interval | null = null
  for (const [at, delta] of events) {
    count += delta
    if (count >= needed && start === null) start = at
    else if (count < needed && start !== null) {
      if (!best || at - start > length(best)) best = { from_m: start, to_m: at }
      start = null
    }
  }
  return best
}

export interface SuggestOptions {
  minOthers?: number
  coverage?: number
  minLengthM?: number
  max?: number
}

/**
 * Stretches of A that at least `minOthers` other activities share. Candidates are the
 * intervals longest first; a supporter covers at least `coverage` of the candidate, which
 * is then trimmed to its longest part covered by `coverage` of its supporters. A stretch
 * overlapping an accepted one by `coverage` (of the longer) is a duplicate.
 */
export const suggestStretches = (
  intervals: ActivityInterval[],
  { minOthers = 2, coverage = 0.8, minLengthM = 400, max = 3 }: SuggestOptions = {},
): Stretch[] => {
  const byActivity = Map.groupBy(intervals, (i) => i.activity_id)
  const accepted: Stretch[] = []
  const duplicate = (s: Interval) => accepted.some((a) => mutualOverlap(a, s) >= coverage)
  for (const candidate of intervals.toSorted((x, y) => length(y) - length(x))) {
    if (length(candidate) <= 0 || duplicate(candidate)) continue
    const supporters = [...byActivity].filter(([, set]) =>
      set.some((i) => overlapM(i, candidate) >= coverage * length(candidate)),
    )
    if (supporters.length < minOthers) continue
    const trimmed = longestCovered(
      supporters.map(([, set]) => set),
      candidate,
      Math.ceil(coverage * supporters.length),
    )
    if (!trimmed || length(trimmed) < minLengthM || duplicate(trimmed)) continue
    accepted.push({ ...trimmed, activity_ids: supporters.map(([id]) => id) })
  }
  return accepted
    .toSorted((x, y) => y.activity_ids.length - x.activity_ids.length || length(y) - length(x))
    .slice(0, max)
}

/** The part of the line between two distances along it (in the same metres `sharedRuns` uses), ends interpolated. */
export const cutLine = (points: LatLon[], fromM: number, toM: number): LatLon[] => {
  const origin = points[0]
  if (!origin || points.length < 2 || toM <= fromM) return []
  const xy = toLocalMetres(points, origin)
  const out: Xy[] = []
  let d = 0
  for (let i = 1; i < xy.length; i++) {
    const a = xy[i - 1]!
    const b = xy[i]!
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const at = (m: number): Xy => {
      const f = len === 0 ? 0 : (m - d) / len
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
    }
    if (out.length === 0 && fromM >= d && fromM <= d + len) out.push(at(fromM))
    if (out.length > 0) {
      if (toM <= d + len) {
        out.push(at(toM))
        break
      }
      out.push(b)
    }
    d += len
  }
  return out
    .filter((p, i) => i === 0 || p[0] !== out[i - 1]![0] || p[1] !== out[i - 1]![1])
    .map((p) => fromLocalMetres(p, origin))
}
