import type { DashboardConfig, DashboardSection, DashboardWidget, SectionType } from '@aurboda/api-spec'

import { defaultDashboardConfig } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { DashboardEditor } from '../../components/DashboardEditor'
import { WidgetRenderer } from '../../components/widgets'
import { fetchDashboard, resetDashboard, saveDashboard } from '../../state/api'
import './style.css'

// Generate unique section ID
const generateSectionId = () => `section-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

// Section renderer - renders a section with its widgets
function DashboardSectionComponent({
  section,
  isEditing,
  onRemoveWidget,
  onMoveWidget,
  onAddWidgetClick,
  onDeleteSection,
}: {
  section: DashboardSection
  isEditing: boolean
  onRemoveWidget?: (widgetId: string) => void
  onMoveWidget?: (widgetId: string, direction: 'up' | 'down') => void
  onAddWidgetClick?: () => void
  onDeleteSection?: () => void
}) {
  const [collapsed, setCollapsed] = useState(section.collapsed ?? false)

  // Determine grid class based on section type
  const gridClass =
    section.type === 'links' ? 'links-grid' : section.type === 'charts' ? 'charts-grid' : 'metrics-grid'

  return (
    <section class="metrics-section">
      <div class="section-header">
        <h2 onClick={() => setCollapsed(!collapsed)} style={{ cursor: 'pointer' }}>
          {section.title}
          {section.widgets.length > 0 && (
            <span class="collapse-indicator">{collapsed ? '\u25B6' : '\u25BC'}</span>
          )}
        </h2>
        {isEditing && (
          <div class="section-edit-controls">
            <button class="section-delete-btn" onClick={onDeleteSection} title="Delete section">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
            </button>
          </div>
        )}
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
              <button class="add-widget-btn" onClick={onAddWidgetClick}>
                + Add Widget
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// Add Section form component
function AddSectionForm({
  onAdd,
  onCancel,
}: {
  onAdd: (title: string, type: SectionType) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState<SectionType>('metrics')

  const handleSubmit = (e: Event) => {
    e.preventDefault()
    if (title.trim()) {
      onAdd(title.trim(), type)
    }
  }

  return (
    <div class="add-section-placeholder">
      <form onSubmit={handleSubmit} style={{ maxWidth: '300px', width: '100%' }}>
        <div class="form-group" style={{ marginBottom: '0.75rem' }}>
          <input
            type="text"
            value={title}
            onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
            placeholder="Section title"
            style={{
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '0.875rem',
              padding: '0.5rem',
              width: '100%',
            }}
            autoFocus
          />
        </div>
        <div class="form-group" style={{ marginBottom: '0.75rem' }}>
          <select
            value={type}
            onChange={(e) => setType((e.target as HTMLSelectElement).value as SectionType)}
            style={{
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '0.875rem',
              padding: '0.5rem',
              width: '100%',
            }}
          >
            <option value="metrics">Metrics (cards)</option>
            <option value="charts">Charts (full width)</option>
            <option value="links">Links (navigation)</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={onCancel}
            class="btn-secondary"
            style={{ fontSize: '0.875rem', padding: '0.375rem 0.75rem' }}
          >
            Cancel
          </button>
          <button
            type="submit"
            class="btn-primary"
            style={{ fontSize: '0.875rem', padding: '0.375rem 0.75rem' }}
            disabled={!title.trim()}
          >
            Add Section
          </button>
        </div>
      </form>
    </div>
  )
}

export function Dashboard() {
  const queryClient = useQueryClient()
  const [isEditing, setIsEditing] = useState(false)
  const [showWidgetPicker, setShowWidgetPicker] = useState<string | null>(null) // section id or null
  const [showAddSection, setShowAddSection] = useState(false)

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
        section.id === sectionId
          ? { ...section, widgets: section.widgets.filter((w) => w.id !== widgetId) }
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

  const handleAddSection = (title: string, type: SectionType) => {
    const newSection: DashboardSection = {
      id: generateSectionId(),
      title,
      type,
      widgets: [],
    }
    const newDashboard: DashboardConfig = {
      ...dashboard,
      sections: [...dashboard.sections, newSection],
    }
    saveMutation.mutate(newDashboard)
    setShowAddSection(false)
  }

  const handleDeleteSection = (sectionId: string) => {
    const section = dashboard.sections.find((s) => s.id === sectionId)
    if (!section) return

    const widgetCount = section.widgets.length
    const message =
      widgetCount > 0
        ? `Delete section "${section.title}" and its ${widgetCount} widget${widgetCount > 1 ? 's' : ''}?`
        : `Delete section "${section.title}"?`

    if (confirm(message)) {
      const newDashboard: DashboardConfig = {
        ...dashboard,
        sections: dashboard.sections.filter((s) => s.id !== sectionId),
      }
      saveMutation.mutate(newDashboard)
    }
  }

  const handleReset = () => {
    if (confirm('Reset dashboard to default configuration? Your customizations will be lost.')) {
      resetMutation.mutate()
      setIsEditing(false)
    }
  }

  return (
    <div class="dashboard">
      <div class="dashboard-header">
        <h1>Dashboard</h1>
        <div class="dashboard-actions">
          {isEditing ? (
            <>
              <button class="btn-secondary" onClick={handleReset}>
                Reset to Default
              </button>
              <button class="btn-primary" onClick={() => setIsEditing(false)}>
                Done Editing
              </button>
            </>
          ) : (
            <button class="btn-edit" onClick={() => setIsEditing(true)} title="Edit Dashboard">
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
          )}
        </div>
      </div>

      {isLoading && <div class="loading">Loading your dashboard...</div>}

      {/* All sections in responsive grid */}
      <div class="sections-grid">
        {dashboard.sections.map((section) => (
          <DashboardSectionComponent
            key={section.id}
            section={section}
            isEditing={isEditing}
            onRemoveWidget={(widgetId) => handleRemoveWidget(section.id, widgetId)}
            onMoveWidget={(widgetId, direction) => handleMoveWidget(section.id, widgetId, direction)}
            onAddWidgetClick={() => setShowWidgetPicker(section.id)}
            onDeleteSection={() => handleDeleteSection(section.id)}
          />
        ))}

        {/* Add Section button/form in edit mode */}
        {isEditing &&
          (showAddSection ? (
            <AddSectionForm onAdd={handleAddSection} onCancel={() => setShowAddSection(false)} />
          ) : (
            <div class="add-section-placeholder">
              <button class="add-section-btn" onClick={() => setShowAddSection(true)}>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add Section
              </button>
            </div>
          ))}
      </div>

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
