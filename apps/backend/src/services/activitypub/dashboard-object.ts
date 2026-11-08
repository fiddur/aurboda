/**
 * The AS2 `content` for a dashboard-period share post (#1505): the dashboard name and the period
 * as a heading, the author's note through the same outbound sanitiser as article prose, one line
 * per figure widget (metric and sparkline cards, the activity summary, record cards) with its
 * change against the previous period, then the dashboard's public page as a plain link when it
 * was published and linked. Charts have no one-line form and are left to the structured payload.
 */
import type {
  ActivitySummaryData,
  DashboardShare,
  DashboardWidget,
  FeedStructuredDashboardShare,
  WidgetData,
} from '@aurboda/api-spec'

import { activityMeasureLabels, percentChange, periodLabel } from '@aurboda/api-spec'

import { escapeXml } from '../charts/chart-svg.ts'
import { formatMeasureValue } from '../feed-exercises.ts'
import {
  resolveStructuredDashboard,
  type StructuredDashboardDeps,
  type StructuredDashboardPost,
} from '../feed-structured-dashboard.ts'
import { renderProse } from './article-object.ts'

const formatFigure = (value: number): string => String(Number(value.toFixed(1)))

/** ` (↑ 4%)`, ` (↓ 2%)` or ` (→)`; empty without a change to show. */
export const changeSuffix = (percent: number | null): string => {
  if (percent === null) return ''
  if (percent > 0.5) return ` (↑ ${Math.round(percent)}%)`
  if (percent < -0.5) return ` (↓ ${Math.round(-percent)}%)`
  return ' (→)'
}

const cardChange = (data: { previous_value?: number | null; trend_percent: number | null }): string =>
  typeof data.previous_value === 'number' ? changeSuffix(data.trend_percent) : ''

const figureChange = (current: number | null, previous: number | null | undefined): string =>
  typeof previous === 'number' ? changeSuffix(percentChange(current, previous)) : ''

const activitySummaryLines = (data: ActivitySummaryData | null): string[] => {
  if (data === null) return []
  const lines: string[] = []
  const { exercise, meditation, sleep } = data
  if (exercise) {
    lines.push(
      `Workouts ${exercise.count} · ${Math.round(exercise.total_minutes)} min${figureChange(exercise.count, exercise.previous_count)}`,
    )
  }
  if (sleep && sleep.avg_hours !== null) {
    lines.push(
      `Sleep ${sleep.avg_hours.toFixed(1)} h${figureChange(sleep.avg_hours, sleep.previous_avg_hours)}`,
    )
  }
  if (meditation) {
    lines.push(`Meditation ${meditation.count}${figureChange(meditation.count, meditation.previous_count)}`)
  }
  return lines
}

const cardLines = (title: string, unit: string | undefined, data: WidgetData | undefined): string[] => {
  if (data?.type !== 'metric_card' && data?.type !== 'sparkline_card') return []
  const figures = data.data
  if (figures === null || figures.value === null) return []
  return [`${title} ${formatFigure(figures.value)}${unit ? ` ${unit}` : ''}${cardChange(figures)}`]
}

const recordLines = (title: string | undefined, data: WidgetData | undefined): string[] => {
  const record = data?.type === 'record_card' ? data.data?.record : null
  if (record == null) return []
  return [
    `${title ?? activityMeasureLabels[record.measure]} ${formatMeasureValue(record.measure, record.value)}`,
  ]
}

/** The one-line forms of a widget's figures; none for a chart, a quick link or a widget without data. */
export const widgetLines = (widget: DashboardWidget, data: WidgetData | undefined): string[] => {
  switch (widget.type) {
    case 'metric_card':
      return cardLines(widget.config.title, widget.config.unit, data)
    case 'sparkline_card':
      return cardLines(widget.config.title ?? widget.config.metric, undefined, data)
    case 'activity_summary':
      return data?.type === 'activity_summary' ? activitySummaryLines(data.data) : []
    case 'record_card':
      return recordLines(widget.config.title, data)
    default:
      return []
  }
}

type DashboardFigures = Pick<FeedStructuredDashboardShare, 'config' | 'widget_data'>

const figureLines = ({ config, widget_data }: DashboardFigures): string[] =>
  config.sections.flatMap((section) =>
    section.widgets.flatMap((widget) => widgetLines(widget, widget_data[widget.id])),
  )

/**
 * The Note `content` HTML. Without the resolved figures (the period could not be resolved) it
 * carries the heading, the note and the link only.
 */
export const renderDashboardShareHtml = (
  dashboard: DashboardShare,
  structured: DashboardFigures | null,
  message: string | null,
): string => {
  const parts = [
    `<p><strong>${escapeXml(dashboard.name)}</strong> · ${escapeXml(periodLabel(dashboard.period))}</p>`,
  ]
  if (message) parts.push(renderProse(message))
  if (structured) {
    const lines = figureLines(structured)
    if (lines.length > 0) parts.push(`<p>${lines.map(escapeXml).join('<br>')}</p>`)
  }
  if (dashboard.url != null) {
    parts.push(
      `<p><a href="${escapeXml(dashboard.url)}" rel="nofollow noopener noreferrer" target="_blank">${escapeXml(dashboard.url)}</a></p>`,
    )
  }
  return parts.join('\n')
}

export interface DashboardNoteContentDeps {
  structured?: StructuredDashboardDeps
}

/** Resolve the period and render the Note content; a resolve failure renders heading, note and link only. */
export const dashboardNoteContent = async (
  user: string,
  post: Omit<StructuredDashboardPost, 'kind'> & { dashboard: DashboardShare },
  deps: DashboardNoteContentDeps = {},
): Promise<string> => {
  const structured = await resolveStructuredDashboard(
    user,
    { ...post, kind: 'dashboard' },
    deps.structured,
  ).catch((error) => {
    console.warn(`⚠️ Dashboard share content for ${user} could not be resolved:`, error)
    return null
  })
  return renderDashboardShareHtml(post.dashboard, structured, post.message)
}
