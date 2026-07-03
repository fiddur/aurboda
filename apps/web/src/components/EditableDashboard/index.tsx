/**
 * EditableDashboard - the section/widget grid with optional inline editing,
 * shared by the home Dashboard and the owner's view of a shared dashboard.
 *
 * Controlled component: it renders `config` and calls `onChange(next)` for every
 * edit (add/remove/move widget, add/delete section). The parent owns
 * persistence (home dashboard vs. a shared dashboard) and the edit toggle.
 */
import type { DashboardConfig, DashboardSection, DashboardWidget, SectionType } from '@aurboda/api-spec'

import { useEffect, useState } from 'preact/hooks'

import { DashboardEditor } from '../DashboardEditor'
import { WidgetRenderer } from '../widgets'

const generateSectionId = () => `section-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

function DashboardSectionComponent({
  section,
  isEditing,
  boardId,
  onRemoveWidget,
  onMoveWidget,
  onAddWidgetClick,
  onDeleteSection,
  onRenameSection,
  onDescriptionChange,
}: {
  section: DashboardSection
  isEditing: boolean
  boardId?: string
  onRemoveWidget?: (widgetId: string) => void
  onMoveWidget?: (widgetId: string, direction: 'up' | 'down') => void
  onAddWidgetClick?: () => void
  onDeleteSection?: () => void
  onRenameSection?: (title: string) => void
  onDescriptionChange?: (description: string | undefined) => void
}) {
  const [collapsed, setCollapsed] = useState(section.collapsed ?? false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(section.title)
  const [descDraft, setDescDraft] = useState(section.description ?? '')
  // Re-sync the draft when the underlying value changes (e.g. reset elsewhere),
  // so a stale draft can't re-persist removed text on blur.
  useEffect(() => setDescDraft(section.description ?? ''), [section.description])

  const commitDescription = () => {
    const next = descDraft.trim() || undefined
    if (next !== section.description) onDescriptionChange?.(next)
  }

  const gridClass =
    section.type === 'links' ? 'links-grid' : section.type === 'charts' ? 'charts-grid' : 'metrics-grid'

  const commitTitle = () => {
    const next = titleDraft.trim()
    if (next && next !== section.title) onRenameSection?.(next)
    else setTitleDraft(section.title)
    setEditingTitle(false)
  }

  const cancelTitle = () => {
    setTitleDraft(section.title)
    setEditingTitle(false)
  }

  return (
    <section class="metrics-section">
      <div class="section-header">
        {editingTitle ? (
          <input
            class="section-title-input"
            type="text"
            value={titleDraft}
            onInput={(e) => setTitleDraft((e.target as HTMLInputElement).value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle()
              else if (e.key === 'Escape') cancelTitle()
            }}
            autoFocus
          />
        ) : (
          <h2 onClick={() => setCollapsed(!collapsed)} style={{ cursor: 'pointer' }}>
            {section.title}
            {section.widgets.length > 0 && <span class="collapse-indicator">{collapsed ? '▶' : '▼'}</span>}
          </h2>
        )}
        {isEditing && !editingTitle && (
          <div class="section-edit-controls">
            <button
              class="section-rename-btn"
              onClick={() => {
                setTitleDraft(section.title)
                setEditingTitle(true)
              }}
              title="Rename section"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
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
      {isEditing ? (
        <textarea
          class="section-intro-input"
          value={descDraft}
          placeholder="Optional intro text shown above this section…"
          onInput={(e) => setDescDraft((e.target as HTMLTextAreaElement).value)}
          onBlur={commitDescription}
          rows={2}
        />
      ) : section.description ? (
        <p class="section-intro">{section.description}</p>
      ) : null}
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
              <WidgetRenderer widget={widget} boardId={boardId} sectionId={section.id} />
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
  /** Identifies this board ('home' or a shared-dashboard id) so chart widgets can link back for update-in-place. */
  boardId: string
}

export function EditableDashboard({ config, isEditing, onChange, boardId }: EditableDashboardProps) {
  const [showWidgetPicker, setShowWidgetPicker] = useState<string | null>(null) // section id or null
  const [showAddSection, setShowAddSection] = useState(false)
  const [descDraft, setDescDraft] = useState(config.description ?? '')
  // Re-sync when config changes under a still-mounted editor (home "Reset to
  // Default", or navigating between shared dashboards), so the draft can't go
  // stale and re-persist stale text on blur.
  useEffect(() => setDescDraft(config.description ?? ''), [config.description])

  const commitDescription = () => {
    const next = descDraft.trim() || undefined
    if (next !== config.description) onChange({ ...config, description: next })
  }

  const handleSectionDescription = (sectionId: string, description: string | undefined) => {
    onChange({
      ...config,
      sections: config.sections.map((s) => (s.id === sectionId ? { ...s, description } : s)),
    })
  }

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

  const handleRenameSection = (sectionId: string, title: string) => {
    onChange({
      ...config,
      sections: config.sections.map((section) =>
        section.id === sectionId ? { ...section, title } : section,
      ),
    })
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
      {isEditing ? (
        <textarea
          class="dashboard-intro-input"
          value={descDraft}
          placeholder="Optional dashboard description — shown on the page and in link previews…"
          onInput={(e) => setDescDraft((e.target as HTMLTextAreaElement).value)}
          onBlur={commitDescription}
          rows={2}
        />
      ) : config.description ? (
        <p class="dashboard-intro">{config.description}</p>
      ) : null}

      {config.sections.map((section) => (
        <DashboardSectionComponent
          key={section.id}
          section={section}
          isEditing={isEditing}
          boardId={boardId}
          onRemoveWidget={(widgetId) => handleRemoveWidget(section.id, widgetId)}
          onMoveWidget={(widgetId, direction) => handleMoveWidget(section.id, widgetId, direction)}
          onAddWidgetClick={() => setShowWidgetPicker(section.id)}
          onDeleteSection={() => handleDeleteSection(section.id)}
          onRenameSection={(title) => handleRenameSection(section.id, title)}
          onDescriptionChange={(description) => handleSectionDescription(section.id, description)}
        />
      ))}

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
