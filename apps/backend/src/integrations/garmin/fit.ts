import type { FileIdMesg, LapMesg, Mesg, RecordMesg, SessionMesg } from '@garmin/fitsdk'

import { Decoder, Stream } from '@garmin/fitsdk'
import { unzipSync } from 'fflate'

import type { Location, TimeSeriesPoint } from '../../db/types.ts'
import type { TrackPoint } from '../../services/tracks.ts'

/** Inflated size above which a ZIP entry is not unpacked: Garmin's own recordings are a few MB at most. */
export const MAX_FIT_ENTRY_BYTES = 100 * 1024 * 1024

export interface FitActivity {
  fileIds: FileIdMesg[]
  sessions: SessionMesg[]
  laps: LapMesg[]
  /** Every record of every `.fit` entry that carries a timestamp, in time order. */
  records: RecordMesg[]
}

export interface FitActivitySummary {
  file_id: Record<string, unknown>[]
  sessions: Record<string, unknown>[]
  laps: Record<string, unknown>[]
  record_count: number
}

export interface FitDetail {
  points: TimeSeriesPoint[]
  gpsPoints: Location[]
  trackPoints: TrackPoint[]
  summary: FitActivitySummary
  /** The first record's time, else the activity start: where the raw record is filed. */
  recordedAt: Date
}

const decodeFit = (bytes: Uint8Array): FitActivity | null => {
  try {
    const decoder = new Decoder(Stream.fromBuffer(Buffer.from(bytes)))
    if (!decoder.isFIT() || !decoder.checkIntegrity()) return null
    const { messages, errors } = decoder.read({ includeUnknownData: false })
    if (errors.length > 0) return null
    return {
      fileIds: messages.fileIdMesgs ?? [],
      laps: messages.lapMesgs ?? [],
      records: messages.recordMesgs ?? [],
      sessions: messages.sessionMesgs ?? [],
    }
  } catch {
    return null
  }
}

const recordTime = (record: RecordMesg): number | null => {
  const ts = record.timestamp
  if (ts instanceof Date) return Number.isFinite(ts.getTime()) ? ts.getTime() : null
  return null
}

/**
 * The activity in Garmin's download ZIP, or null when the archive holds no readable
 * `.fit` entry. Several entries are merged into one activity.
 */
export const parseActivityFit = (
  zipBytes: Uint8Array,
  maxEntryBytes: number = MAX_FIT_ENTRY_BYTES,
): FitActivity | null => {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(zipBytes, {
      filter: (file) => /\.fit$/i.test(file.name) && file.originalSize <= maxEntryBytes,
    })
  } catch {
    return null
  }

  const decoded = Object.entries(entries)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, bytes]) => decodeFit(bytes))
    .filter((fit): fit is FitActivity => fit !== null)
  if (decoded.length === 0) return null

  const records = decoded
    .flatMap((fit) => fit.records)
    .flatMap((record) => {
      const time = recordTime(record)
      return time === null ? [] : [{ record, time }]
    })
    .sort((a, b) => a.time - b.time)
    .map(({ record }) => record)

  return {
    fileIds: decoded.flatMap((fit) => fit.fileIds),
    laps: decoded.flatMap((fit) => fit.laps),
    records,
    sessions: decoded.flatMap((fit) => fit.sessions),
  }
}

const SEMICIRCLE_TO_DEGREES = 180 / 2 ** 31

const round3 = (value: number): number => Math.round(value * 1000) / 1000

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/** Sports whose FIT cadence counts strides per minute, so the step cadence is twice it. */
const FOOT_SPORTS = new Set(['running', 'walking', 'hiking'])

interface RecordMetric {
  metric: string
  unit: string
  read: (record: RecordMesg) => number | null
  allowNegative?: boolean
}

const runCadence = (record: RecordMesg): number | null => {
  const cadence = num(record.cadence)
  return cadence === null ? null : (cadence + (num(record.fractionalCadence) ?? 0)) * 2
}

const scaled =
  (read: (record: RecordMesg) => unknown, factor: number) =>
  (record: RecordMesg): number | null => {
    const value = num(read(record))
    return value === null ? null : value * factor
  }

/** The `DETAIL_METRIC_MAP` metrics that have a FIT profile `record` field, in the JSON path's units. */
const RECORD_METRICS: RecordMetric[] = [
  { metric: 'heart_rate', read: (r) => num(r.heartRate), unit: 'bpm' },
  {
    metric: 'respiratory_rate',
    read: (r) => num(r.enhancedRespirationRate) ?? num(r.respirationRate),
    unit: 'brpm',
  },
  { metric: 'speed', read: (r) => num(r.enhancedSpeed) ?? num(r.speed), unit: 'm/s' },
  {
    allowNegative: true,
    metric: 'elevation',
    read: (r) => num(r.enhancedAltitude) ?? num(r.altitude),
    unit: 'm',
  },
  { metric: 'power', read: (r) => num(r.power), unit: 'W' },
  { allowNegative: true, metric: 'vertical_speed', read: (r) => num(r.verticalSpeed), unit: 'm/s' },
  { metric: 'ground_contact_time', read: (r) => num(r.stanceTime), unit: 'ms' },
  { metric: 'vertical_oscillation', read: scaled((r) => r.verticalOscillation, 0.1), unit: 'cm' },
  { metric: 'vertical_ratio', read: (r) => num(r.verticalRatio), unit: 'percent' },
  { metric: 'stride_length', read: scaled((r) => r.stepLength, 0.001), unit: 'm' },
  { metric: 'stress_level', read: (r) => num(r.currentStress), unit: 'score' },
]

const RUN_CADENCE: RecordMetric = { metric: 'run_cadence', read: runCadence, unit: 'spm' }

const recordPoints = (record: RecordMesg, time: Date, metrics: RecordMetric[]): TimeSeriesPoint[] =>
  metrics.flatMap(({ allowNegative, metric, read, unit }) => {
    const value = read(record)
    if (value === null || (!allowNegative && value <= 0)) return []
    return [{ metric, source: 'garmin' as const, time, unit, value: round3(value) }]
  })

const recordPosition = (record: RecordMesg): { lat: number; lon: number } | null => {
  const lat = num(record.positionLat)
  const lon = num(record.positionLong)
  if (lat === null || lon === null || (lat === 0 && lon === 0)) return null
  return { lat: lat * SEMICIRCLE_TO_DEGREES, lon: lon * SEMICIRCLE_TO_DEGREES }
}

const withoutDeveloperFields = (mesg: Mesg): Record<string, unknown> => {
  const { developerFields: _developerFields, ...rest } = mesg
  return rest as Record<string, unknown>
}

export const fitToDetail = (fit: FitActivity, activityStart: Date): FitDetail => {
  const footSport = fit.sessions.some((session) => FOOT_SPORTS.has(String(session.sport)))
  const metrics = footSport ? [...RECORD_METRICS, RUN_CADENCE] : RECORD_METRICS

  const points: TimeSeriesPoint[] = []
  const gpsPoints: Location[] = []
  const trackPoints: TrackPoint[] = []
  let firstTime: Date | null = null

  for (const record of fit.records) {
    const ms = recordTime(record)
    if (ms === null) continue
    const time = new Date(ms)
    firstTime ??= time
    points.push(...recordPoints(record, time, metrics))

    const position = recordPosition(record)
    if (!position) continue
    gpsPoints.push({ ...position, source: 'garmin', time })
    const alt = num(record.enhancedAltitude) ?? num(record.altitude)
    trackPoints.push({ ...position, alt: alt === null ? null : round3(alt), time })
  }

  return {
    gpsPoints,
    points,
    recordedAt: firstTime ?? activityStart,
    summary: {
      file_id: fit.fileIds.map(withoutDeveloperFields),
      laps: fit.laps.map(withoutDeveloperFields),
      record_count: fit.records.length,
      sessions: fit.sessions.map(withoutDeveloperFields),
    },
    trackPoints,
  }
}
