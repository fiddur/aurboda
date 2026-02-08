import type { DashboardConfig, DashboardSection, DashboardWidget } from '@aurboda/api-spec'
import { defaultDashboardConfig } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'
import { DashboardEditor } from '../../components/DashboardEditor'
import { WidgetRenderer } from '../../components/widgets'
import { fetchDashboard, resetDashboard, saveDashboard } from '../../state/api'

import './style.css'

// Section renderer - renders a section with its widgets
function DashboardSectionComponent({
  section,
  isEditing,
  onRemoveWidget,
  onMoveWidget,
}: {
  section: DashboardSection
  isEditing: boolean
  onRemoveWidget?: (widgetId: string) => void
  onMoveWidget?: (widgetId: string, direction: 'up' | 'down') => void
}) {
  const [collapsed, setCollapsed] = useState(section.collapsed ?? false)

  // Determine grid class based on section type
  const gridClass =
    section.type === 'links' ? 'links-grid'
    : section.type === 'charts' ? 'charts-grid'
    : 'metrics-grid'

  return (
    <section class="metrics-section">
      <div class="section-header">
        <h2 onClick={() => setCollapsed(!collapsed)} style={{ cursor: 'pointer' }}>
          {section.title}
          {section.widgets.length > 0 && (
            <span class="collapse-indicator">{collapsed ? '\u25B6' : '\u25BC'}</span>
          )}
        </h2>
      </div>
      {!collapsed && (
        <div class={gridClass}>
          {section.widgets.map((widget, index) => (
            <div key={widget.id} class={isEditing ? 'widget-editing-wrapper' : ''}>
              {isEditing && (
                <div class="widget-edit-controls">
                  {index > 0 && (
                    <button
                      class="widget-move-btn"
                      onClick={() => onMoveWidget?.(widget.id, 'up')}
                      title="Move up"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <path d="M12 19V5M5 12l7-7 7 7" />
                      </svg>
                    </button>
                  )}
                  {index < section.widgets.length - 1 && (
                    <button
                      class="widget-move-btn"
                      onClick={() => onMoveWidget?.(widget.id, 'down')}
                      title="Move down"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <path d="M12 5v14M5 12l7 7 7-7" />
                      </svg>
                    </button>
                  )}
                  <button
                    class="widget-remove-btn"
                    onClick={() => onRemoveWidget?.(widget.id)}
                    title="Remove widget"
                  >
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
              )}
              <WidgetRenderer widget={widget} />
            </div>
          ))}
          {isEditing && (
            <div class="add-widget-placeholder">
              <button class="add-widget-btn" data-section-id={section.id}>
                + Add Widget
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export function Dashboard() {
  const queryClient = useQueryClient()
  const [isEditing, setIsEditing] = useState(false)
  const [showWidgetPicker, setShowWidgetPicker] = useState<string | null>(null) // section id or null

  // Fetch dashboard configuration
  const dashboardQuery = useQuery({
    queryFn: fetchDashboard,
    queryKey: ['dashboard'],
    staleTime: 5 * 60 * 1000,
  })

  // Mutation to save dashboard
  const saveMutation = useMutation({
    mutationFn: saveDashboard,
    onSuccess: (data) => {
      queryClient.setQueryData(['dashboard'], data)
    },
  })

  // Mutation to reset dashboard
  const resetMutation = useMutation({
    mutationFn: resetDashboard,
    onSuccess: (data) => {
      queryClient.setQueryData(['dashboard'], data)
    },
  })

  const dashboard: DashboardConfig = dashboardQuery.data ?? defaultDashboardConfig
  const isLoading = dashboardQuery.isLoading

  // Handlers for editing
  const handleRemoveWidget = (sectionId: string, widgetId: string) => {
    const newDashboard: DashboardConfig = {
      ...dashboard,
      sections: dashboard.sections.map((section) =>
        section.id === sectionId ?
          { ...section, widgets: section.widgets.filter((w) => w.id !== widgetId) }
        : section,
      ),
    }
    saveMutation.mutate(newDashboard)
  }

  const handleMoveWidget = (sectionId: string, widgetId: string, direction: 'up' | 'down') => {
    const section = dashboard.sections.find((s) => s.id === sectionId)
    if (!section) return

    const widgetIndex = section.widgets.findIndex((w) => w.id === widgetId)
    if (widgetIndex === -1) return

    const newIndex = direction === 'up' ? widgetIndex - 1 : widgetIndex + 1
    if (newIndex < 0 || newIndex >= section.widgets.length) return

    const newWidgets = [...section.widgets]
    const [widget] = newWidgets.splice(widgetIndex, 1)
    newWidgets.splice(newIndex, 0, widget)

    const newDashboard: DashboardConfig = {
      ...dashboard,
      sections: dashboard.sections.map((s) => (s.id === sectionId ? { ...s, widgets: newWidgets } : s)),
    }
    saveMutation.mutate(newDashboard)
  }

  const handleAddWidget = (sectionId: string, widget: DashboardWidget) => {
    const newDashboard: DashboardConfig = {
      ...dashboard,
      sections: dashboard.sections.map((section) =>
        section.id === sectionId ? { ...section, widgets: [...section.widgets, widget] } : section,
      ),
    }
    saveMutation.mutate(newDashboard)
    setShowWidgetPicker(null)
  }

  const handleReset = () => {
    if (confirm('Reset dashboard to default configuration? Your customizations will be lost.')) {
      resetMutation.mutate()
      setIsEditing(false)
    }
  }

  // Organize sections into columns for layout
  const metricsSections = dashboard.sections.filter((s) => s.type === 'metrics')
  const chartsSections = dashboard.sections.filter((s) => s.type === 'charts')
  const linksSections = dashboard.sections.filter((s) => s.type === 'links')

  return (
    <div class="dashboard">
      <div class="dashboard-header">
        <h1>Dashboard</h1>
        <div class="dashboard-actions">
          {isEditing ?
            <>
              <button class="btn-secondary" onClick={handleReset}>
                Reset to Default
              </button>
              <button class="btn-primary" onClick={() => setIsEditing(false)}>
                Done Editing
              </button>
            </>
          : <button class="btn-edit" onClick={() => setIsEditing(true)} title="Edit Dashboard">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          }
        </div>
      </div>

      {isLoading && <div class="loading">Loading your dashboard...</div>}

      {/* Metrics sections in two columns */}
      {metricsSections.length > 0 && (
        <div class="metrics-columns">
          {metricsSections.map((section) => (
            <DashboardSectionComponent
              key={section.id}
              section={section}
              isEditing={isEditing}
              onRemoveWidget={(widgetId) => handleRemoveWidget(section.id, widgetId)}
              onMoveWidget={(widgetId, direction) => handleMoveWidget(section.id, widgetId, direction)}
            />
          ))}
        </div>
      )}

      {/* Charts and links sections in two columns */}
      {(chartsSections.length > 0 || linksSections.length > 0) && (
        <div class="bottom-columns">
          {chartsSections.map((section) => (
            <DashboardSectionComponent
              key={section.id}
              section={section}
              isEditing={isEditing}
              onRemoveWidget={(widgetId) => handleRemoveWidget(section.id, widgetId)}
              onMoveWidget={(widgetId, direction) => handleMoveWidget(section.id, widgetId, direction)}
            />
          ))}
          {linksSections.map((section) => (
            <DashboardSectionComponent
              key={section.id}
              section={section}
              isEditing={isEditing}
              onRemoveWidget={(widgetId) => handleRemoveWidget(section.id, widgetId)}
              onMoveWidget={(widgetId, direction) => handleMoveWidget(section.id, widgetId, direction)}
            />
          ))}
        </div>
      )}

      {/* Widget picker modal */}
      {showWidgetPicker && (
        <DashboardEditor
          sectionId={showWidgetPicker}
          sectionType={dashboard.sections.find((s) => s.id === showWidgetPicker)?.type ?? 'metrics'}
          onAddWidget={(widget) => handleAddWidget(showWidgetPicker, widget)}
          onClose={() => setShowWidgetPicker(null)}
        />
      )}
    </div>
  )
}
