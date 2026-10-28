import * as d3 from 'd3'
import { format } from 'date-fns'

export interface TimeTick {
  date: Date
  label: string
  year: boolean
}

export interface TimeAxisLayout {
  ticks: TimeTick[]
  rotate: boolean
  yearBreaks: TimeTick[]
  bottomMargin: number
}

type StepKind = 'clock' | 'day' | 'month' | 'year'

interface Step {
  kind: StepKind
  ms: number
  dates: (start: Date, end: Date) => Date[]
}

type Group = d3.Selection<SVGGElement, unknown, null, undefined>

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const ROTATED_LABEL_PX = 44
const CHAR_PX = 6.5
const LABEL_GAP_PX = 12
const YEAR_BREAK_MIN_DAYS = 120

const inclusive = (end: Date) => new Date(end.getTime() + 1)

const intervalStep = (kind: StepKind, interval: d3.TimeInterval | null, ms: number): Step => ({
  dates: (start, end) => interval?.range(start, inclusive(end)) ?? [],
  kind,
  ms,
})

const evenDayStep = (days: number): Step => ({
  dates: (start, end) => d3.timeDay.range(start, inclusive(end)).filter((_, i) => i % days === 0),
  kind: 'day',
  ms: days * DAY_MS,
})

const clockSteps: Step[] = [
  ...[1, 5, 15, 30].map((n) => intervalStep('clock', d3.timeMinute.every(n), n * MINUTE_MS)),
  ...[1, 3, 6, 12].map((n) => intervalStep('clock', d3.timeHour.every(n), n * HOUR_MS)),
]

const weekSteps: Step[] = [1, 2].map((n) => intervalStep('day', d3.timeWeek.every(n), n * 7 * DAY_MS))

const monthSteps: Step[] = [1, 2, 3, 6].map((n) =>
  intervalStep('month', d3.timeMonth.every(n), n * 30 * DAY_MS),
)

const yearSteps: Step[] = [1, 2, 5].map((n) => intervalStep('year', d3.timeYear.every(n), n * 365 * DAY_MS))

const candidateSteps = (spanDays: number): Step[] => [
  ...(spanDays <= 2 ? clockSteps : []),
  ...(spanDays > 0 && spanDays <= 31 ? [evenDayStep(Math.max(1, Math.ceil(spanDays / 6)))] : []),
  ...(spanDays <= 180 ? weekSteps : []),
  ...monthSteps,
  ...yearSteps,
]

const isStartOf = (interval: d3.TimeInterval, date: Date) => interval.floor(date).getTime() === date.getTime()

const tickLabel = (date: Date, kind: StepKind): string => {
  if (isStartOf(d3.timeYear, date)) return format(date, 'yyyy')
  if (kind === 'clock') return format(date, isStartOf(d3.timeDay, date) ? 'd MMM' : 'HH:mm')
  if (kind === 'day') return format(date, 'd MMM')
  if (kind === 'month') return format(date, 'MMM')
  return format(date, 'yyyy')
}

const toTick = (date: Date, kind: StepKind): TimeTick => ({
  date,
  label: tickLabel(date, kind),
  year: isStartOf(d3.timeYear, date),
})

const withYearBreaks = (ticks: TimeTick[], breaks: TimeTick[], stepMs: number): TimeTick[] => {
  const tickTimes = new Set(ticks.map((t) => t.date.getTime()))
  const missing = breaks.filter((b) => !tickTimes.has(b.date.getTime()))
  if (missing.length === 0) return ticks
  const crowdsBreak = (t: TimeTick) =>
    !t.year && missing.some((b) => Math.abs(t.date.getTime() - b.date.getTime()) < stepMs / 2)
  return [...ticks.filter((t) => !crowdsBreak(t)), ...missing].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  )
}

const horizontalLabelPx = (ticks: TimeTick[]) =>
  Math.max(0, ...ticks.map((t) => t.label.length)) * CHAR_PX + LABEL_GAP_PX

const fits = (ticks: TimeTick[], innerWidth: number) =>
  ticks.length >= 2 && ticks.length * Math.min(ROTATED_LABEL_PX, horizontalLabelPx(ticks)) <= innerWidth

export function timeAxisLayout([start, end]: [Date, Date], innerWidth: number): TimeAxisLayout {
  const spanDays = (end.getTime() - start.getTime()) / DAY_MS
  const yearBreaks =
    spanDays >= YEAR_BREAK_MIN_DAYS
      ? d3.timeYear.range(new Date(start.getTime() + 1), end).map((d) => toTick(d, 'year'))
      : []
  const ticksFor = (step: Step) => {
    const stepTicks = step.dates(start, end).map((d) => toTick(d, step.kind))
    // Year steps already label every year they have room for; adding the skipped years back would overcrowd.
    return step.kind === 'year' ? stepTicks : withYearBreaks(stepTicks, yearBreaks, step.ms)
  }
  const steps = candidateSteps(spanDays)
  let ticks: TimeTick[] = []
  for (const step of steps) {
    ticks = ticksFor(step)
    if (fits(ticks, innerWidth)) break
  }
  const rotate = ticks.length * horizontalLabelPx(ticks) > innerWidth
  return { bottomMargin: rotate ? 50 : 30, rotate, ticks, yearBreaks }
}

export function renderYearBreaks(
  g: Group,
  x: d3.ScaleTime<number, number>,
  innerHeight: number,
  layout: TimeAxisLayout,
) {
  g.append('g')
    .attr('class', 'year-breaks')
    .selectAll('line')
    .data(layout.yearBreaks)
    .join('line')
    .attr('class', 'year-break')
    .attr('x1', (d) => x(d.date))
    .attr('x2', (d) => x(d.date))
    .attr('y1', 0)
    .attr('y2', innerHeight)
    .attr('stroke', 'currentColor')
    .attr('stroke-opacity', 0.25)
    .attr('stroke-width', 1)
}

export function renderTimeAxis(
  g: Group,
  x: d3.ScaleTime<number, number>,
  innerHeight: number,
  layout: TimeAxisLayout,
) {
  const byTime = new Map(layout.ticks.map((t) => [t.date.getTime(), t]))
  const tickAt = (d: Date | d3.NumberValue) => byTime.get(+d)
  const text = g
    .append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom(x)
        .tickValues(layout.ticks.map((t) => t.date))
        .tickFormat((d) => tickAt(d)?.label ?? ''),
    )
    .selectAll<SVGTextElement, Date>('text')
    .attr('font-size', '11px')
    .attr('font-weight', (d) => (tickAt(d)?.year ? 600 : null))
  if (layout.rotate) {
    text.attr('text-anchor', 'end').attr('dx', '-0.3em').attr('dy', '0.3em').attr('transform', 'rotate(-35)')
  }
}
