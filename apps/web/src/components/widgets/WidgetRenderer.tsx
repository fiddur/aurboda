import type { DashboardWidget } from '@aurboda/api-spec'

import { ActivitySummaryWidget } from './ActivitySummaryWidget'
import { ActivityTypeCardWidget } from './ActivityTypeCardWidget'
import { BarChartWidget } from './BarChartWidget'
import { CombinedChartWidget } from './CombinedChartWidget'
import { CorrelationWidget } from './CorrelationWidget'
import { GoalProgressWidget } from './GoalProgressWidget'
import { HrZonesWidget } from './HrZonesWidget'
import { LastSleepWidget } from './LastSleepWidget'
import { MetricCardWidget } from './MetricCardWidget'
import { PlacesCardWidget } from './PlacesCardWidget'
import { QuickLinkWidget } from './QuickLinkWidget'
import { RecordCardWidget } from './RecordCardWidget'
import { SparklineCardWidget } from './SparklineCardWidget'
import { TopListCardWidget } from './TopListCardWidget'
import { TrendChartWidget } from './TrendChartWidget'

interface WidgetRendererProps {
  widget: DashboardWidget
  isEditing?: boolean
  onRemove?: () => void
  /** Board this widget belongs to ('home' or a shared-dashboard id) — enables update-in-place from the chart page. */
  boardId?: string
  sectionId?: string
}

export function WidgetRenderer({ widget, isEditing, onRemove, boardId, sectionId }: WidgetRendererProps) {
  const origin =
    boardId && sectionId ? { board_id: boardId, section_id: sectionId, widget_id: widget.id } : undefined

  // eslint-disable-next-line complexity -- one arm per widget type
  const renderWidget = () => {
    switch (widget.type) {
      case 'metric_card':
        return <MetricCardWidget config={widget.config} />
      case 'sparkline_card':
        return <SparklineCardWidget config={widget.config} />
      case 'trend_chart':
        return <TrendChartWidget config={widget.config} origin={origin} />
      case 'bar_chart':
        return <BarChartWidget config={widget.config} origin={origin} />
      case 'correlation':
        return <CorrelationWidget config={widget.config} />
      case 'activity_summary':
        return <ActivitySummaryWidget config={widget.config} />
      case 'quick_link':
        return <QuickLinkWidget config={widget.config} />
      case 'hr_zones':
        return <HrZonesWidget config={widget.config} />
      case 'goal_progress':
        return <GoalProgressWidget config={widget.config} />
      case 'last_sleep':
        return <LastSleepWidget config={widget.config} />
      case 'combined_chart':
        return <CombinedChartWidget config={widget.config} />
      case 'record_card':
        return <RecordCardWidget config={widget.config} />
      case 'activity_type_card':
        return <ActivityTypeCardWidget config={widget.config} />
      case 'top_list_card':
        return <TopListCardWidget config={widget.config} />
      case 'places_card':
        return <PlacesCardWidget config={widget.config} />
      default:
        return <div class="widget-unknown">Unknown widget type</div>
    }
  }

  if (isEditing) {
    return (
      <div class="widget-wrapper editing" data-widget-id={widget.id}>
        <div class="widget-controls">
          <button class="widget-remove" onClick={onRemove} title="Remove widget">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        {renderWidget()}
      </div>
    )
  }

  return renderWidget()
}
