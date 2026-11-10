/**
 * Controlled component: it renders `config` and calls `onChange(next)` for every
 * edit (add/remove/move widget, add/delete section). The parent owns
 * persistence (home dashboard vs. a shared dashboard) and the edit toggle.
 */
import type {
  DashboardConfig,
  DashboardSection,
  DashboardWidget,
  PeriodGranularity,
  SectionType,
  WidgetDataMap,
} from '@aurboda/api-spec'
import type { TargetedDragEvent } from 'preact'

import { useEffect, useRef, useState } from 'preact/hooks'

import { DashboardEditor } from '../DashboardEditor'
import { PublicWidgetRenderer, WidgetRenderer } from '../widgets'
import { dropWidget, type DropTarget, moveSection, moveWidget } from './moveWidget'

const generateSectionId = () => `section-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

const periodOptions: { label: string; value: '' | PeriodGranularity }[] = [
  { label: 'Rolling', value: '' },
  { label: 'Weekly', value: 'week' },
  { label: 'Monthly', value: 'month' },
  { label: 'Yearly', value: 'year' },
]

const WIDGET_MIME = 'application/x-aurboda-widget'

type LayoutAxis = 'column' | 'row'

interface ShownDropTarget extends DropTarget {
  axis?: LayoutAxis
}

interface WidgetDrag {
  draggingId: string | null
  target: ShownDropTarget | null
  start: (widgetId: string) => void
  over: (target: ShownDropTarget | null) => void
  drop: () => void
  end: () => void
}

const isWidgetDrag = (e: DragEvent) => e.dataTransfer?.types.includes(WIDGET_MIME) ?? false

/** Siblings share a top edge in a multi-column grid; in a single column they stack. */
const layoutAxis = (el: HTMLElement): LayoutAxis =>
  [el.previousElementSibling, el.nextElementSibling].some(
    (sibling) => sibling instanceof HTMLElement && sibling.offsetTop === el.offsetTop,
  )
    ? 'row'
    : 'column'

const sameTarget = (a: ShownDropTarget | null, b: ShownDropTarget | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.sectionId === b.sectionId &&
    a.widgetId === b.widgetId &&
    a.side === b.side &&
    a.axis === b.axis)

const gridDropProps = (sectionId: string, gridClass: string, drag: WidgetDrag) => ({
  class:
    drag.target?.sectionId === sectionId && drag.target.widgetId === undefined
      ? `${gridClass} drop-into`
      : gridClass,
  onDragLeave: (e: TargetedDragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) drag.over(null)
  },
  onDragOver: (e: TargetedDragEvent<HTMLDivElement>) => {
    if (!isWidgetDrag(e)) return
    e.preventDefault()
    if (drag.target?.sectionId !== sectionId) drag.over({ sectionId })
  },
  onDrop: (e: TargetedDragEvent<HTMLDivElement>) => {
    if (!isWidgetDrag(e)) return
    e.preventDefault()
    drag.drop()
  },
})

const editingWrapperClass = (widgetId: string, drag?: WidgetDrag) =>
  [
    'widget-editing-wrapper',
    drag?.draggingId === widgetId && 'widget-dragging',
    drag?.target?.widgetId === widgetId && `drop-${drag.target.side} drop-${drag.target.axis}`,
  ]
    .filter(Boolean)
    .join(' ')

const widgetDragOver =
  (sectionId: string, widgetId: string, drag: WidgetDrag) => (e: TargetedDragEvent<HTMLDivElement>) => {
    if (!isWidgetDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    const el = e.currentTarget
    const axis = layoutAxis(el)
    const rect = el.getBoundingClientRect()
    const before =
      axis === 'row' ? e.clientX < rect.left + rect.width / 2 : e.clientY < rect.top + rect.height / 2
    drag.over({ axis, sectionId, side: before ? 'before' : 'after', widgetId })
  }

function DragHandle({ widgetId, drag }: { widgetId: string; drag: WidgetDrag }) {
  return (
    <span
      class="widget-drag-handle"
      draggable
      role="img"
      title="Drag to move"
      aria-label="Drag to move"
      onDragStart={(e) => {
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData(WIDGET_MIME, widgetId)
          const wrapper = e.currentTarget.closest<HTMLElement>('.widget-editing-wrapper')
          if (wrapper) {
            const rect = wrapper.getBoundingClientRect()
            e.dataTransfer.setDragImage(wrapper, e.clientX - rect.left, e.clientY - rect.top)
          }
        }
        drag.start(widgetId)
      }}
      onDragEnd={drag.end}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
        <circle cx="9" cy="5" r="1.75" />
        <circle cx="15" cy="5" r="1.75" />
        <circle cx="9" cy="12" r="1.75" />
        <circle cx="15" cy="12" r="1.75" />
        <circle cx="9" cy="19" r="1.75" />
        <circle cx="15" cy="19" r="1.75" />
      </svg>
    </span>
  )
}

function SectionMoveButtons({ onMove }: { onMove: { down?: () => void; up?: () => void } }) {
  return (
    <>
      {onMove.up && (
        <button class="section-rename-btn" onClick={onMove.up} title="Move section up">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      )}
      {onMove.down && (
        <button class="section-rename-btn" onClick={onMove.down} title="Move section down">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
        </button>
      )}
    </>
  )
}

/** The config with its period set to `granularity`, or without one for a rolling dashboard. */
export const withPeriod = (config: DashboardConfig, granularity: '' | PeriodGranularity): DashboardConfig => {
  const { period: _period, ...rest } = config
  return granularity ? { ...rest, period: { granularity } } : rest
}

function DashboardSectionComponent({
  section,
  isEditing,
  boardId,
  widgetData,
  widgetDataLoading,
  periodLabel,
  onRemoveWidget,
  onMoveWidget,
  onAddWidgetClick,
  onDeleteSection,
  onRenameSection,
  onDescriptionChange,
  onMoveSection,
  drag,
}: {
  section: DashboardSection
  isEditing: boolean
  boardId?: string
  widgetData?: WidgetDataMap
  widgetDataLoading?: boolean
  periodLabel?: string
  onRemoveWidget?: (widgetId: string) => void
  onMoveWidget?: (widgetId: string, direction: 'up' | 'down') => void
  onAddWidgetClick?: () => void
  onDeleteSection?: () => void
  onRenameSection?: (title: string) => void
  onDescriptionChange?: (description: string | undefined) => void
  onMoveSection: { down?: () => void; up?: () => void }
  drag?: WidgetDrag
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
            <SectionMoveButtons onMove={onMoveSection} />
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
        <div class={gridClass} {...(drag && gridDropProps(section.id, gridClass, drag))}>
          {section.widgets.map((widget, index) => (
            <div
              key={widget.id}
              class={isEditing ? editingWrapperClass(widget.id, drag) : ''}
              onDragOver={drag && widgetDragOver(section.id, widget.id, drag)}
            >
              {isEditing && (
                <div class="widget-edit-controls">
                  {drag && <DragHandle widgetId={widget.id} drag={drag} />}
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
              {widgetData &&
              widgetDataLoading &&
              widget.type !== 'quick_link' &&
              widgetData[widget.id] === undefined ? (
                <div class="widget-note">Loading…</div>
              ) : widgetData ? (
                <PublicWidgetRenderer
                  widget={widget}
                  data={widgetData[widget.id]}
                  periodLabel={periodLabel}
                />
              ) : (
                <WidgetRenderer widget={widget} boardId={boardId} sectionId={section.id} />
              )}
            </div>
          ))}
          {isEditing && (
            <div
              class="add-widget-placeholder"
              onDragOver={(e) => {
                if (!drag || !isWidgetDrag(e)) return
                e.preventDefault()
                e.stopPropagation()
                drag.over({ sectionId: section.id })
              }}
            >
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
  /** Server-resolved data per widget id (a period dashboard); widgets fetch their own when absent. */
  widgetData?: WidgetDataMap
  /** Whether `widgetData` is being fetched or about to be, so a widget without an entry yet shows as loading. */
  widgetDataLoading?: boolean
  /** The shown period's label, for widgets that name their window. */
  periodLabel?: string
}

export function EditableDashboard({
  config,
  isEditing,
  onChange,
  boardId,
  widgetData,
  widgetDataLoading,
  periodLabel,
}: EditableDashboardProps) {
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

    onChange(moveWidget(config, widgetId, sectionId, newIndex))
  }

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<ShownDropTarget | null>(null)
  const draggingRef = useRef<string | null>(null)
  const dropTargetRef = useRef<ShownDropTarget | null>(null)

  const showDropTarget = (target: ShownDropTarget | null) => {
    const dragged = draggingRef.current
    const shown = target && dragged && dropWidget(config, dragged, target) !== config ? target : null
    if (sameTarget(shown, dropTargetRef.current)) return
    dropTargetRef.current = shown
    setDropTarget(shown)
  }

  const endDrag = () => {
    draggingRef.current = null
    setDraggingId(null)
    showDropTarget(null)
  }

  const drag: WidgetDrag = {
    draggingId,
    drop: () => {
      const dragged = draggingRef.current
      const target = dropTargetRef.current
      if (dragged && target) {
        const next = dropWidget(config, dragged, target)
        if (next !== config) onChange(next)
      }
      endDrag()
    },
    end: endDrag,
    over: showDropTarget,
    start: (widgetId) => {
      draggingRef.current = widgetId
      // Deferred so the browser snapshots the drag image before the card fades.
      setTimeout(() => setDraggingId(draggingRef.current), 0)
    },
    target: dropTarget,
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
      {isEditing && (
        <label class="dashboard-period-setting">
          Period
          <select
            value={config.period?.granularity ?? ''}
            onChange={(e) =>
              onChange(withPeriod(config, (e.target as HTMLSelectElement).value as '' | PeriodGranularity))
            }
          >
            {periodOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
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

      {config.sections.map((section, index) => (
        <DashboardSectionComponent
          key={section.id}
          section={section}
          isEditing={isEditing}
          boardId={boardId}
          widgetData={widgetData}
          widgetDataLoading={widgetDataLoading}
          periodLabel={periodLabel}
          onRemoveWidget={(widgetId) => handleRemoveWidget(section.id, widgetId)}
          onMoveWidget={(widgetId, direction) => handleMoveWidget(section.id, widgetId, direction)}
          onAddWidgetClick={() => setShowWidgetPicker(section.id)}
          onDeleteSection={() => handleDeleteSection(section.id)}
          onRenameSection={(title) => handleRenameSection(section.id, title)}
          onDescriptionChange={(description) => handleSectionDescription(section.id, description)}
          onMoveSection={{
            down:
              index < config.sections.length - 1
                ? () => onChange(moveSection(config, section.id, 'down'))
                : undefined,
            up: index > 0 ? () => onChange(moveSection(config, section.id, 'up')) : undefined,
          }}
          drag={isEditing ? drag : undefined}
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
          periodMode={Boolean(config.period)}
          onAddWidget={(widget) => handleAddWidget(showWidgetPicker, widget)}
          onClose={() => setShowWidgetPicker(null)}
        />
      )}
    </div>
  )
}
