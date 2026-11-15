import type { DayOverviewConfig } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import * as d3 from 'd3'
import { format } from 'date-fns'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import type { Activity, ActivityTypeDefinition } from '../../state/api'

import { ACTIVITY_LANE_CATEGORIES, DURATION_ACTIVITY_COLORS } from '../../pages/Timeline/activityMerge'
import { buildViewHash, getDefaultOrientation } from '../../pages/Timeline/viewHash'
import { fetchActivities, fetchActivityTypeDefinitions, fetchBucketedMetrics } from '../../state/api'
import { parseBucketedResponse } from '../../utils/chart'
import { toDisplayName } from '../../utils/displayName'
import { isEmoji, isIconPath, isUrl } from '../../utils/emojiLookup'
import { getMetricDisplayName } from '../../utils/metricLabels'
import {
  averageValue,
  barColor,
  type BucketValue,
  clipSpans,
  collapseIcons,
  contiguousRuns,
  dayOverviewEmptyMessage,
  dayOverviewRange,
  formatRangeLabel,
  hourTicks,
  isSleepType,
  latestValue,
  metricSeries,
  resolveDayOverviewConfig,
  type TimeRange,
  valueDomain,
} from './dayOverview'
import './DayOverviewWidget.css'

const HOUR_MS = 3_600_000
const SLEEP_LOOKBEHIND_MS = 12 * HOUR_MS
const PLOT_TOP = 6
const PLOT_BOTTOM = 92
const ICON_Y = 108
const ICON_R = 9
const AXIS_Y = 134
const HEIGHT = 140
const LINE_COLOR = '#0ea5e9'
const DEFAULT_ICON_COLOR = '#f59e0b'

interface DayIcon {
  x: number
  label: string
  icon: string | undefined
  color: string
  time: Date
}

const useWidth = () => {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

function IconGlyph({ item, x }: { item: DayIcon; x: number }) {
  if (item.icon && isEmoji(item.icon)) {
    return (
      <text
        x={x}
        y={ICON_Y + 0.5}
        class="day-overview-emoji"
        text-anchor="middle"
        dominant-baseline="central"
      >
        {item.icon}
      </text>
    )
  }
  if (item.icon && (isUrl(item.icon) || isIconPath(item.icon))) {
    const size = ICON_R * 1.3
    return <image href={item.icon} x={x - size / 2} y={ICON_Y - size / 2} width={size} height={size} />
  }
  return (
    <text
      x={x}
      y={ICON_Y + 0.5}
      class="day-overview-initial"
      text-anchor="middle"
      dominant-baseline="central"
    >
      {item.label.charAt(0).toUpperCase()}
    </text>
  )
}

interface PlotProps {
  width: number
  range: TimeRange
  barMetric: string
  bars: BucketValue[]
  lineMetric: string | undefined
  line: BucketValue[]
  sleep: { start_time: Date; end_time: Date; label: string }[]
  icons: Omit<DayIcon, 'x'>[]
}

function DayOverviewPlot({ width, range, barMetric, bars, lineMetric, line, sleep, icons }: PlotProps) {
  const x = d3.scaleTime().domain([range.start, range.end]).range([0, width]).clamp(true)
  const yBars = d3
    .scaleLinear()
    .domain(
      valueDomain(
        barMetric,
        bars.map((b) => b.value),
      ),
    )
    .range([PLOT_BOTTOM, PLOT_TOP])
  const yLine = d3
    .scaleLinear()
    .domain(
      valueDomain(
        lineMetric ?? '',
        line.map((p) => p.value),
      ),
    )
    .range([PLOT_BOTTOM, PLOT_TOP])
  const mid = (p: BucketValue) => x(new Date((p.start.getTime() + p.end.getTime()) / 2))
  const runs = contiguousRuns(line)
  const linePath = d3
    .line<BucketValue>()
    .x(mid)
    .y((p) => yLine(p.value))
  const areaPath = d3
    .area<BucketValue>()
    .x(mid)
    .y0(PLOT_BOTTOM)
    .y1((p) => yLine(p.value))
  const groups = collapseIcons(
    icons.map((icon) => ({ ...icon, x: x(icon.time) })),
    ICON_R * 2 + 2,
  )
  const ticks = hourTicks(range, width)

  return (
    <svg width={width} height={HEIGHT} class="day-overview-svg" aria-hidden="true">
      {sleep.map((s, i) => (
        <rect
          key={`sleep-${i}`}
          class="day-overview-sleep"
          x={x(s.start_time)}
          y={PLOT_TOP}
          width={Math.max(1, x(s.end_time) - x(s.start_time))}
          height={PLOT_BOTTOM - PLOT_TOP}
        >
          <title>{s.label}</title>
        </rect>
      ))}
      {ticks.map((t) => (
        <line
          key={`grid-${t.getTime()}`}
          class="day-overview-grid"
          x1={x(t)}
          x2={x(t)}
          y1={PLOT_TOP}
          y2={PLOT_BOTTOM}
        />
      ))}
      {runs.map((run, i) => (
        <path key={`area-${i}`} class="day-overview-area" d={areaPath(run) ?? ''} fill={LINE_COLOR} />
      ))}
      {bars.map((b) => {
        const x0 = x(b.start)
        const w = Math.max(1, (x(b.end) - x0) * 0.8)
        const y = yBars(b.value)
        return (
          <rect
            key={`bar-${b.start.getTime()}`}
            x={x0}
            y={y}
            width={w}
            height={Math.max(0, PLOT_BOTTOM - y)}
            fill={barColor(barMetric, b.value)}
          />
        )
      })}
      {runs.map((run, i) => (
        <path key={`line-${i}`} class="day-overview-line" d={linePath(run) ?? ''} stroke={LINE_COLOR} />
      ))}
      <line class="day-overview-baseline" x1={0} x2={width} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM} />
      {groups.map((g) => {
        const [first] = g.items
        if (!first) return null
        const cx = Math.min(Math.max(g.x, ICON_R + 1), width - ICON_R - 1)
        const title = g.items.map((item) => `${format(item.time, 'HH:mm')} ${item.label}`).join('\n')
        return (
          <g key={`icon-${g.x}`} class="day-overview-icon">
            <title>{title}</title>
            {g.items.length > 1 ? (
              <>
                <circle cx={cx} cy={ICON_Y} r={ICON_R} class="day-overview-more" />
                <text
                  x={cx}
                  y={ICON_Y + 0.5}
                  class="day-overview-more-text"
                  text-anchor="middle"
                  dominant-baseline="central"
                >
                  +{g.items.length}
                </text>
              </>
            ) : (
              <>
                <circle cx={cx} cy={ICON_Y} r={ICON_R} fill={first.color} />
                <IconGlyph item={first} x={cx} />
              </>
            )}
          </g>
        )
      })}
      {ticks.map((t) => (
        <text
          key={`tick-${t.getTime()}`}
          class="day-overview-tick"
          x={Math.min(Math.max(x(t), 8), width - 8)}
          y={AXIS_Y}
          text-anchor="middle"
        >
          {format(t, 'HH')}
        </text>
      ))}
    </svg>
  )
}

const roundedNow = () => {
  const now = new Date()
  now.setSeconds(0, 0)
  return now
}

const iconOf = (
  activity: Activity,
  defs: ReadonlyMap<string, ActivityTypeDefinition>,
): Omit<DayIcon, 'x'> => {
  const def = defs.get(activity.activity_type)
  return {
    color: def?.color ?? DURATION_ACTIVITY_COLORS[activity.activity_type] ?? DEFAULT_ICON_COLOR,
    icon: def?.icon,
    label: activity.title ?? def?.display_name ?? toDisplayName(activity.activity_type),
    time: activity.start_time,
  }
}

const formatValue = (value: number | undefined) => (value === undefined ? undefined : Math.round(value))

type DayStatus = 'loading' | 'failed' | 'empty' | 'ready'

interface DayData {
  status: DayStatus
  bars: BucketValue[]
  line: BucketValue[]
  icons: Omit<DayIcon, 'x'>[]
  sleep: PlotProps['sleep']
}

const dayStatus = (
  loading: boolean,
  failed: boolean,
  parts: Pick<DayData, 'bars' | 'line' | 'icons' | 'sleep'>,
): DayStatus => {
  if (loading) return 'loading'
  if (failed) return 'failed'
  return Object.values(parts).every((part) => part.length === 0) ? 'empty' : 'ready'
}

const useDayOverviewData = (
  range: TimeRange,
  dataEnd: Date,
  barMetric: string,
  lineMetric: string | undefined,
): DayData => {
  const metrics = lineMetric ? [barMetric, lineMetric] : [barMetric]
  const metricsQuery = useQuery({
    queryFn: () => fetchBucketedMetrics(range.start, dataEnd, metrics, '5m'),
    queryKey: ['day-overview-metrics', metrics, range.start.toISOString(), dataEnd.toISOString()],
    staleTime: 5 * 60 * 1000,
  })
  const activitiesQuery = useQuery({
    queryFn: () => fetchActivities(new Date(range.start.getTime() - SLEEP_LOOKBEHIND_MS), dataEnd),
    queryKey: ['day-overview-activities', range.start.toISOString(), dataEnd.toISOString()],
    staleTime: 5 * 60 * 1000,
  })
  const { data: typeDefs = [] } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activityTypeDefinitions'],
    staleTime: 5 * 60_000,
  })

  const defs = useMemo(() => new Map(typeDefs.map((t) => [t.name, t])), [typeDefs])
  const buckets = useMemo(() => parseBucketedResponse(metricsQuery.data), [metricsQuery.data])
  const bars = useMemo(() => metricSeries(buckets, barMetric), [buckets, barMetric])
  const line = useMemo(() => (lineMetric ? metricSeries(buckets, lineMetric) : []), [buckets, lineMetric])
  const { icons, sleep } = useMemo(() => {
    const shown = (activitiesQuery.data ?? []).filter((a) => {
      const def = defs.get(a.activity_type)
      return def?.show_on_timeline !== false && ACTIVITY_LANE_CATEGORIES.has(def?.display_category ?? 'other')
    })
    const isSleep = (a: Activity) => isSleepType(a.activity_type, defs.get(a.activity_type)?.parent_type)
    return {
      icons: shown
        .filter((a) => !isSleep(a) && a.start_time >= range.start && a.start_time <= range.end)
        .map((a) => iconOf(a, defs)),
      sleep: clipSpans(shown.filter(isSleep), range).map((s) => ({
        ...s,
        label: `${iconOf(s, defs).label} ${format(s.start_time, 'HH:mm')}–${format(s.end_time, 'HH:mm')}`,
      })),
    }
  }, [activitiesQuery.data, defs, range])

  const status = dayStatus(
    metricsQuery.isLoading || activitiesQuery.isLoading,
    metricsQuery.isError && activitiesQuery.isError,
    { bars, icons, line, sleep },
  )
  return { bars, icons, line, sleep, status }
}

function DayFigures({
  barMetric,
  bars,
  line,
  lineMetric,
}: Pick<PlotProps, 'barMetric' | 'bars' | 'line' | 'lineMetric'>) {
  const latestLine = formatValue(latestValue(line))
  const averageBar = formatValue(averageValue(bars))
  return (
    <p class="day-overview-figures">
      {lineMetric && latestLine !== undefined && (
        <span>
          <span class="day-overview-swatch" style={{ background: LINE_COLOR }} />
          {getMetricDisplayName(lineMetric)} <strong>{latestLine}</strong>
        </span>
      )}
      {averageBar !== undefined && (
        <span>
          <span class="day-overview-swatch" style={{ background: barColor(barMetric, 60) }} />
          {getMetricDisplayName(barMetric)} avg <strong>{averageBar}</strong>
        </span>
      )}
    </p>
  )
}

export function DayOverviewWidget({ config }: { config: DayOverviewConfig }) {
  const { barMetric, lineMetric, title, window } = resolveDayOverviewConfig(config)
  const [now] = useState(roundedNow)
  const range = useMemo(() => dayOverviewRange(window, now), [window, now])
  const dataEnd = range.end < now ? range.end : now
  const { ref, width } = useWidth()
  const { bars, icons, line, sleep, status } = useDayOverviewData(range, dataEnd, barMetric, lineMetric)
  const href = `/timeline${buildViewHash(range.start, range.end, new Set(), getDefaultOrientation())}`

  const body = {
    empty: <div class="no-data day-overview-empty">{dayOverviewEmptyMessage(window)}</div>,
    failed: <div class="chart-error">Could not load the day</div>,
    loading: <div class="chart-loading">Loading...</div>,
    ready: width > 0 && (
      <DayOverviewPlot
        width={width}
        range={range}
        barMetric={barMetric}
        bars={bars}
        lineMetric={lineMetric}
        line={line}
        sleep={sleep}
        icons={icons}
      />
    ),
  }

  return (
    <a href={href} class="chart-widget chart-widget-link day-overview" title="Open in the timeline">
      <div class="chart-widget-header">
        <h4>{title}</h4>
        <p class="chart-widget-value">{formatRangeLabel(window, range)}</p>
      </div>
      {status === 'ready' && (
        <DayFigures barMetric={barMetric} bars={bars} line={line} lineMetric={lineMetric} />
      )}
      <div ref={ref} class="day-overview-plot">
        {body[status]}
      </div>
    </a>
  )
}
