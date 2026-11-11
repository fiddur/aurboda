/**
 * The challenge race chart (#994): one cumulative line per member over the
 * challenge window, the standings as they stood at render time. The server
 * twin of the race the web draws natively (`apps/web/src/pages/Feed/timeline-challenge.ts`'s
 * `standingsRaceSeries`), so a consumer that cannot draw it (Mastodon) gets the
 * same picture as an attachment. Pure and synchronous like `chart-svg.ts`:
 * rasterize with `sharp` for the PNG or serve the string as `image/svg+xml`.
 */
import type {
  FeedStructuredChallenge,
  QuantChallengeDocument,
  QuantChallengeSample,
  QuantStandings,
} from '@aurboda/api-spec'

import { maxOf } from '../numeric-extremes.ts'
import { CHART_HEIGHT, CHART_WIDTH, escapeXml, scale } from './chart-svg.ts'

export interface RaceLine {
  name: string
  color: string
  points: [Date, number][]
}

export interface RaceChartSvgData {
  title: string
  asOf: Date
  startTime: Date
  endTime: Date
  timezone: string
  lines: RaceLine[]
}

export interface RaceChartSvgOptions {
  width?: number
  height?: number
  /** Only the lines and baseline, on a transparent background: no `<text>`, no legend (see `ChartSvgOptions.bare`). */
  bare?: boolean
}

const PAD = 40
const LEGEND_W = 200
const LEGEND_MAX = 8
const LEGEND_ROW = 26
const LEGEND_NAME_MAX = 16
const PLOT_TOP = 96
const BG = '#0b0f19'
const AXIS_COLOR = '#4b5563'
const TEXT_COLOR = '#e5e7eb'
const MUTED_COLOR = '#9ca3af'
const FONT = 'Liberation Sans, sans-serif'
const MIN_DRAWABLE_POINTS = 2
const BARE_PAD = 6

/**
 * The web's `MEMBER_COLORS` order and lighten rule
 * (`apps/web/src/pages/Challenges/member-colors.ts`, mirrored by Android's
 * `challengeMemberColor` in `ChallengeWidgetModel.kt`): change all three together.
 */
const MEMBER_COLORS = ['#2b9ea7', '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#84cc16']
const LIGHTEN_PERCENT = 35

const hex2 = (n: number): string => n.toString(16).padStart(2, '0')

const towardWhite = (channel: number): number =>
  Math.floor((channel * (100 - LIGHTEN_PERCENT) + 255 * LIGHTEN_PERCENT + 50) / 100)

const lighten = (color: string): string =>
  `#${[1, 3, 5].map((i) => hex2(towardWhite(Number.parseInt(color.slice(i, i + 2), 16)))).join('')}`

export const raceMemberColor = (index: number): string => {
  const base = MEMBER_COLORS[index % MEMBER_COLORS.length]
  return Math.floor(index / MEMBER_COLORS.length) % 2 === 1 ? lighten(base) : base
}

const UNIT_SECONDS: Record<string, number> = { d: 86_400, h: 3_600, m: 60, s: 1 }

const bucketSeconds = (bucket: string): number => {
  const match = /^(\d+)(s|m|h|d)$/.exec(bucket)
  return match ? Number(match[1]) * UNIT_SECONDS[match[2]] : 0
}

const sampleValue = (sample: QuantChallengeSample, max: boolean): number =>
  max ? (sample.max ?? sample.sum ?? sample.avg ?? 0) : (sample.sum ?? sample.count ?? sample.avg ?? 0)

/**
 * One line per standings member in leaderboard order: the start line at 0, then
 * the running total (best sample so far for `max` scoring) at each bucket's
 * end. A member with nothing to draw is dropped, but the others keep the colour
 * of their leaderboard position.
 */
export const raceLinesFromStandings = (
  challenge: QuantChallengeDocument,
  standings: QuantStandings,
): RaceLine[] => {
  const start = Date.parse(challenge.startTime)
  if (Number.isNaN(start)) return []
  const bucketMs = bucketSeconds(standings.bucket) * 1000
  const max = challenge.scoring === 'max'
  return standings.members
    .map((member, i) => {
      const points: [Date, number][] = [[new Date(start), 0]]
      let running = 0
      for (const sample of [...member.samples].sort((a, b) => a.offset - b.offset)) {
        const value = sampleValue(sample, max)
        running = max ? Math.max(running, value) : running + value
        points.push([new Date(start + sample.offset * 1000 + bucketMs), running])
      }
      return { color: raceMemberColor(i), name: member.name, points }
    })
    .filter((line) => line.points.length >= MIN_DRAWABLE_POINTS)
}

/** The race chart's inputs for a resolved challenge post, or null when it carries no standings. */
export const raceChartDataFor = (structured: FeedStructuredChallenge): RaceChartSvgData | null => {
  const { challenge, standings } = structured
  if (standings == null) return null
  return {
    asOf: new Date(standings.asOf),
    endTime: new Date(challenge.endTime),
    lines: raceLinesFromStandings(challenge, standings),
    startTime: new Date(challenge.startTime),
    timezone: challenge.timezone,
    title: challenge.name,
  }
}

const formatInZone = (date: Date, timeZone: string, options: Intl.DateTimeFormatOptions): string => {
  if (Number.isNaN(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone }).format(date)
  } catch {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(date)
  }
}

export const formatChartDate = (date: Date, timeZone: string): string =>
  formatInZone(date, timeZone, { day: 'numeric', month: 'short', year: 'numeric' })

const formatChartDateTime = (date: Date, timeZone: string): string =>
  formatInZone(date, timeZone, {
    day: 'numeric',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  })

const truncate = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

const text = (x: number, y: number, size: number, fill: string, content: string, extra = ''): string =>
  `<text x="${x}" y="${y}" fill="${fill}" font-family="${FONT}" font-size="${size}"${extra}>${escapeXml(content)}</text>`

const legendSvg = (lines: RaceLine[], x: number): string => {
  const rows = lines.slice(0, LEGEND_MAX).map((line, i) => {
    const y = PLOT_TOP + i * LEGEND_ROW
    return `<rect x="${x}" y="${y - 12}" width="14" height="14" rx="3" fill="${line.color}"/>
  ${text(x + 22, y, 18, TEXT_COLOR, truncate(line.name, LEGEND_NAME_MAX))}`
  })
  if (lines.length > LEGEND_MAX) {
    rows.push(
      text(x, PLOT_TOP + LEGEND_MAX * LEGEND_ROW, 16, MUTED_COLOR, `+${lines.length - LEGEND_MAX} more`),
    )
  }
  return rows.join('\n  ')
}

/**
 * Build the race chart as a self-contained SVG string: title and snapshot time
 * top-left, the plot with a baseline, `0` and max-total labels and the window's
 * start/end dates, one polyline per drawable line, and a legend in the
 * right-hand column (first eight members).
 */
export const buildRaceChartSvg = (data: RaceChartSvgData, opts: RaceChartSvgOptions = {}): string => {
  const width = opts.width ?? CHART_WIDTH
  const height = opts.height ?? CHART_HEIGHT
  const plotLeft = opts.bare ? BARE_PAD : PAD + 56
  const plotRight = opts.bare ? width - BARE_PAD : width - PAD - LEGEND_W
  const plotTop = opts.bare ? BARE_PAD : PLOT_TOP
  const plotBottom = opts.bare ? height - BARE_PAD : height - PAD - 20
  const tStart = data.startTime.getTime()
  const tEnd = data.endTime.getTime()
  const lines = data.lines
    .map((line) => ({
      ...line,
      points: line.points.filter(([t, v]) => Number.isFinite(v) && !Number.isNaN(t.getTime())),
    }))
    .filter((line) => line.points.length >= MIN_DRAWABLE_POINTS)
  const vMax = maxOf(lines.flatMap((line) => line.points.map(([, v]) => v))) ?? 0
  const top = Math.max(vMax, 0)

  const x = (t: number) => scale(Math.min(Math.max(t, tStart), tEnd), tStart, tEnd, plotLeft, plotRight)
  const y = (v: number) => scale(v, 0, top, plotBottom, plotTop)
  const polylines = lines
    .map((line) => {
      const points = line.points.map(([t, v]) => `${x(t.getTime()).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
      return `<polyline points="${points}" fill="none" stroke="${line.color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`
    })
    .join('\n  ')

  const baseline = `<line x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" stroke="${AXIS_COLOR}" stroke-width="1"/>`

  if (opts.bare) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${baseline}
  ${polylines}
</svg>`
  }
  const asOf = formatChartDateTime(data.asOf, data.timezone)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${BG}" rx="16"/>
  ${text(PAD, PAD + 4, 26, TEXT_COLOR, data.title, ' font-weight="700"')}
  ${asOf ? text(PAD, PAD + 30, 18, MUTED_COLOR, `as of ${asOf}`) : ''}
  ${baseline}
  ${text(plotLeft - 10, plotBottom + 6, 18, MUTED_COLOR, '0', ' text-anchor="end"')}
  ${top > 0 ? text(plotLeft - 10, PLOT_TOP + 6, 18, MUTED_COLOR, Math.round(top).toLocaleString('en-US'), ' text-anchor="end"') : ''}
  ${text(plotLeft, height - PAD + 10, 18, MUTED_COLOR, formatChartDate(data.startTime, data.timezone))}
  ${text(plotRight, height - PAD + 10, 18, MUTED_COLOR, formatChartDate(data.endTime, data.timezone), ' text-anchor="end"')}
  ${polylines}
  ${legendSvg(lines, plotRight + 24)}
</svg>`
}
