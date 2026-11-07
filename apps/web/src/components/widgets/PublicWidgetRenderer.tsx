/**
 * PublicWidgetRenderer - Renders a dashboard widget read-only from server-
 * resolved data (the `widget_data` map returned by the public shared-dashboard
 * endpoint). Unlike WidgetRenderer, it never fetches: it passes the resolved
 * payload straight into each presentational `*View` component.
 */

import type { DashboardWidget, WidgetData } from '@aurboda/api-spec'

import { ActivitySummaryView } from './ActivitySummaryWidget'
import { BarChartView } from './BarChartWidget'
import { CombinedChartView } from './CombinedChartWidget'
import { CorrelationView } from './CorrelationWidget'
import { GoalProgressView } from './GoalProgressWidget'
import { HrZonesView } from './HrZonesWidget'
import { LastSleepView } from './LastSleepWidget'
import { MetricCardView } from './MetricCardWidget'
import { QuickLinkView } from './QuickLinkWidget'
import { RecordCardView } from './RecordCardWidget'
import { SparklineCardView } from './SparklineCardWidget'
import { TrendChartView } from './TrendChartWidget'

interface PublicWidgetRendererProps {
  widget: DashboardWidget
  /** Resolved data for this widget id (from the public endpoint). */
  data?: WidgetData
  /** On a period dashboard: the shown period, for headers and the not-applicable note. */
  periodLabel?: string
}

const NotForAPeriod = () => <div class="widget-note">Not available for a period</div>

// eslint-disable-next-line complexity -- one arm per widget type
export function PublicWidgetRenderer({ widget, data, periodLabel }: PublicWidgetRendererProps) {
  switch (widget.type) {
    case 'metric_card':
      return <MetricCardView config={widget.config} data={data?.type === 'metric_card' ? data.data : null} />
    case 'sparkline_card':
      return (
        <SparklineCardView config={widget.config} data={data?.type === 'sparkline_card' ? data.data : null} />
      )
    case 'trend_chart':
      return <TrendChartView config={widget.config} data={data?.type === 'trend_chart' ? data.data : null} />
    case 'bar_chart':
      return <BarChartView config={widget.config} data={data?.type === 'bar_chart' ? data.data : null} />
    case 'correlation':
      return <CorrelationView config={widget.config} data={data?.type === 'correlation' ? data.data : null} />
    case 'activity_summary':
      return (
        <ActivitySummaryView
          config={widget.config}
          data={data?.type === 'activity_summary' ? data.data : null}
          periodLabel={periodLabel}
        />
      )
    case 'quick_link':
      return <QuickLinkView config={widget.config} />
    case 'hr_zones':
      return (
        <HrZonesView
          config={widget.config}
          data={data?.type === 'hr_zones' ? data.data : null}
          periodLabel={periodLabel}
        />
      )
    case 'goal_progress':
      if (periodLabel && !data?.data) return <NotForAPeriod />
      return (
        <GoalProgressView config={widget.config} data={data?.type === 'goal_progress' ? data.data : null} />
      )
    case 'last_sleep':
      if (periodLabel && !data?.data) return <NotForAPeriod />
      return <LastSleepView config={widget.config} data={data?.type === 'last_sleep' ? data.data : null} />
    case 'combined_chart':
      return (
        <CombinedChartView config={widget.config} data={data?.type === 'combined_chart' ? data.data : null} />
      )
    case 'record_card':
      return <RecordCardView config={widget.config} data={data?.type === 'record_card' ? data.data : null} />
    default:
      return <div class="widget-unknown">Unknown widget type</div>
  }
}
