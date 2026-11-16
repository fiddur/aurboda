export interface TimedPoint {
  lat: number
  lon: number
  t: number
}

export interface SegmentPass {
  start_offset_s: number
  elapsed_s: number
}

export interface PassOptions {
  bufferM?: number
  /** How far the projection may step back (GPS jitter) before the pass is abandoned. */
  backtrackM?: number
}

const EARTH_RADIUS_M = 6_371_008.8
const DEG = Math.PI / 180
/** A pass that turns off within this of the segment end (a runner stopping at it, GPS noise) still counts, ending where it got furthest. */
const END_TOLERANCE_M = 10

interface Projection {
  /** Distance to the polyline, metres. */
  d: number
  /** Position along the polyline from its start, metres; negative before the start and past the length after the end. */
  s: number
}

/** A local equirectangular frame around `origin`: accurate to well under a metre over a few km. */
const localFrame = (origin: { lat: number; lon: number }) => {
  const kx = Math.cos(origin.lat * DEG) * EARTH_RADIUS_M * DEG
  const ky = EARTH_RADIUS_M * DEG
  return (p: { lat: number; lon: number }): [number, number] => [
    (p.lon - origin.lon) * kx,
    (p.lat - origin.lat) * ky,
  ]
}

const polylineProjector = (line: [number, number][]) => {
  const edges = line.slice(1).map((b, i) => {
    const a = line[i]!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    return { a, dx, dy, len2: dx * dx + dy * dy, len: Math.hypot(dx, dy) }
  })
  const cumulative: number[] = []
  let total = 0
  for (const edge of edges) {
    cumulative.push(total)
    total += edge.len
  }
  const last = edges.length - 1

  const project = ([x, y]: [number, number]): Projection => {
    let best = { d: Infinity, s: 0 }
    edges.forEach((edge, k) => {
      if (edge.len2 === 0) return
      const raw = ((x - edge.a[0]) * edge.dx + (y - edge.a[1]) * edge.dy) / edge.len2
      const u = Math.min(1, Math.max(0, raw))
      const d = Math.hypot(x - (edge.a[0] + u * edge.dx), y - (edge.a[1] + u * edge.dy))
      if (d >= best.d) return
      const along = (k === 0 && raw < 0) || (k === last && raw > 1) ? raw : u
      best = { d, s: cumulative[k]! + along * edge.len }
    })
    return best
  }
  return { length: total, project }
}

const crossingTime = (a: TimedPoint, sa: number, b: TimedPoint, sb: number, at: number): number =>
  sb === sa ? b.t : a.t + ((at - sa) / (sb - sa)) * (b.t - a.t)

interface Attempt {
  entry: number
  maxS: number
  maxT: number
}

/**
 * Every complete pass of a track over a directional segment. A pass enters where the
 * projection crosses the segment start (between two samples, interpolated) and stays
 * within `bufferM` of the line, never stepping back more than `backtrackM`, until it
 * crosses the segment end. A track that begins or ends inside the segment, leaves the
 * buffer, or runs it backwards gives no pass.
 */
export const findSegmentPasses = (
  points: TimedPoint[],
  segment: { lat: number; lon: number }[],
  { bufferM = 25, backtrackM = 30 }: PassOptions = {},
): SegmentPass[] => {
  if (points.length < 2 || segment.length < 2) return []
  const toXy = localFrame(segment[0]!)
  const { length, project } = polylineProjector(segment.map(toXy))
  if (length === 0) return []
  return scanPasses(
    points,
    points.map((p) => project(toXy(p))),
    { backtrackM, bufferM, length },
  )
}

const scanPasses = (
  points: TimedPoint[],
  proj: Projection[],
  { backtrackM, bufferM, length }: { backtrackM: number; bufferM: number; length: number },
): SegmentPass[] => {
  const passes: SegmentPass[] = []
  const finish = (attempt: Attempt, exit: number) =>
    passes.push({ elapsed_s: exit - attempt.entry, start_offset_s: attempt.entry })
  const abandon = (attempt: Attempt) => {
    if (attempt.maxS >= length - END_TOLERANCE_M) finish(attempt, attempt.maxT)
  }
  const leaves = (attempt: Attempt, p: Projection) =>
    (p.d > bufferM && p.s < length) || p.s < attempt.maxS - backtrackM

  let attempt: Attempt | null = null
  for (let i = 1; i < points.length; i++) {
    const [prev, cur] = [proj[i - 1]!, proj[i]!]
    const [a, b] = [points[i - 1]!, points[i]!]
    if (prev.s < 0 && cur.s >= 0 && cur.d <= bufferM) {
      attempt = { entry: crossingTime(a, prev.s, b, cur.s, 0), maxS: cur.s, maxT: b.t }
    } else if (!attempt) continue
    else if (leaves(attempt, cur)) {
      abandon(attempt)
      attempt = null
      continue
    } else if (cur.s > attempt.maxS) {
      attempt.maxS = cur.s
      attempt.maxT = b.t
    }
    if (cur.s >= length) {
      finish(attempt, crossingTime(a, prev.s, b, cur.s, length))
      attempt = null
    }
  }
  if (attempt) abandon(attempt)
  return passes
}
