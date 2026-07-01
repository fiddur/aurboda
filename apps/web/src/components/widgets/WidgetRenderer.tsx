/**
 * WidgetRenderer - Routes widget type to correct component.
 */

import type { DashboardWidget } from '@aurboda/api-spec'

import { ActivitySummaryWidget } from './ActivitySummaryWidget'
import { BarChartWidget } from './BarChartWidget'
import { CorrelationWidget } from './CorrelationWidget'
import { GoalProgressWidget } from './GoalProgressWidget'
import { HrZonesWidget } from './HrZonesWidget'
import { MetricCardWidget } from './MetricCardWidget'
import { QuickLinkWidget } from './QuickLinkWidget'
import { SparklineCardWidget } from './SparklineCardWidget'
import { TrendChartWidget } from './TrendChartWidget'

interface WidgetRendererProps {
  widget: DashboardWidget
  isEditing?: boolean
  onRemove?: () => void
  /** Board this widget belongs to ('home' or a shared-dashboard id) — enables update-in-place from the chart page. */
  boardId?: string
  /** Section this widget belongs to. */
  sectionId?: string
}

export function WidgetRenderer({ widget, isEditing, onRemove, boardId, sectionId }: WidgetRendererProps) {
  const origin =
    boardId && sectionId ? { board_id: boardId, section_id: sectionId, widget_id: widget.id } : undefined

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
