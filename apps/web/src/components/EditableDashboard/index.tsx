/**
 * EditableDashboard - the section/widget grid with optional inline editing,
 * shared by the home Dashboard and the owner's view of a shared dashboard.
 *
 * Controlled component: it renders `config` and calls `onChange(next)` for every
 * edit (add/remove/move widget, add/delete section). The parent owns
 * persistence (home dashboard vs. a shared dashboard) and the edit toggle.
 */
import type { DashboardConfig, DashboardSection, DashboardWidget, SectionType } from '@aurboda/api-spec'

import { useState } from 'preact/hooks'

import { DashboardEditor } from '../DashboardEditor'
import { WidgetRenderer } from '../widgets'

const generateSectionId = () => `section-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

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

  const gridClass =
    section.type === 'links' ? 'links-grid' : section.type === 'charts' ? 'charts-grid' : 'metrics-grid'

  return (
    <section class="metrics-section">
      <div class="section-header">
        <h2 onClick={() => setCollapsed(!collapsed)} style={{ cursor: 'pointer' }}>
          {section.title}
          {section.widgets.length > 0 && (
            <span class="collapse-indicator">{collapsed ? '▶' : '▼'}</span>
          )}
        </h2>
        {isEditing && (
          <div class="section-edit-controls">
            <button class="section-delete-btn" onClick={onDeleteSection} title="Delete section">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 5v14M5 12l7 7 7-7" />
                      </svg>
                    </button>
                  )}
                  <button
                    class="widget-remove-btn"
                    onClick={() => onRemoveWidget?.(widget.id)}
                    title="Remove widget"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
    if (title.trim()) onAdd(title.trim(), type)
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

interface EditableDashboardProps {
  config: DashboardConfig
  isEditing: boolean
  onChange: (next: DashboardConfig) => void
}

export function EditableDashboard({ config, isEditing, onChange }: EditableDashboardProps) {
  const [showWidgetPicker, setShowWidgetPicker] = useState<string | null>(null) // section id or null
  const [showAddSection, setShowAddSection] = useState(false)

  const handleRemoveWidget = (sectionId: string, widgetId: string) => {
    onChange({
      ...config,
      sections: config.sections.map((section) =>
        section.id === sectionId
          ? { ...section, widgets: section.widgets.filter((w) => w.id !== widgetId) }
          : section,
      ),
    })
  }

  const handleMoveWidget = (sectionId: string, widgetId: string, direction: 'up' | 'down') => {
    const section = config.sections.find((s) => s.id === sectionId)
    if (!section) return

    const widgetIndex = section.widgets.findIndex((w) => w.id === widgetId)
    if (widgetIndex === -1) return

    const newIndex = direction === 'up' ? widgetIndex - 1 : widgetIndex + 1
    if (newIndex < 0 || newIndex >= section.widgets.length) return

    const newWidgets = [...section.widgets]
    const [widget] = newWidgets.splice(widgetIndex, 1)
    newWidgets.splice(newIndex, 0, widget)

    onChange({
      ...config,
      sections: config.sections.map((s) => (s.id === sectionId ? { ...s, widgets: newWidgets } : s)),
    })
  }

  const handleAddWidget = (sectionId: string, widget: DashboardWidget) => {
    onChange({
      ...config,
      sections: config.sections.map((section) =>
        section.id === sectionId ? { ...section, widgets: [...section.widgets, widget] } : section,
      ),
    })
    setShowWidgetPicker(null)
  }

  const handleAddSection = (title: string, type: SectionType) => {
    const newSection: DashboardSection = { id: generateSectionId(), title, type, widgets: [] }
    onChange({ ...config, sections: [...config.sections, newSection] })
    setShowAddSection(false)
  }

  const handleDeleteSection = (sectionId: string) => {
    const section = config.sections.find((s) => s.id === sectionId)
    if (!section) return

    const widgetCount = section.widgets.length
    const message =
      widgetCount > 0
        ? `Delete section "${section.title}" and its ${widgetCount} widget${widgetCount > 1 ? 's' : ''}?`
        : `Delete section "${section.title}"?`

    if (confirm(message)) {
      onChange({ ...config, sections: config.sections.filter((s) => s.id !== sectionId) })
    }
  }

  return (
    <div class="sections-grid">
      {config.sections.map((section) => (
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

      {isEditing &&
        (showAddSection ? (
          <AddSectionForm onAdd={handleAddSection} onCancel={() => setShowAddSection(false)} />
        ) : (
          <div class="add-section-placeholder">
            <button class="add-section-btn" onClick={() => setShowAddSection(true)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add Section
            </button>
          </div>
        ))}

      {showWidgetPicker && (
        <DashboardEditor
          sectionId={showWidgetPicker}
          sectionType={config.sections.find((s) => s.id === showWidgetPicker)?.type ?? 'metrics'}
          onAddWidget={(widget) => handleAddWidget(showWidgetPicker, widget)}
          onClose={() => setShowWidgetPicker(null)}
        />
      )}
    </div>
  )
}
