/**
 * Shared component that renders activity title, time, duration, and notes
 * in either read mode (plain text) or edit mode (input fields).
 */
import { ActivityTypePicker } from '../../components/ActivityTypePicker'
import { IconPreview } from '../../components/IconPreview'
import { formatDuration } from './format-utils'

export interface ActivityDraft {
  activity_type: string
  title: string
  start_time: string // yyyy-MM-ddTHH:mm for datetime-local
  end_time: string
  notes: string
  data?: Record<string, unknown>
}

interface EditableActivityFieldsProps {
  title: string
  isEditing: boolean
  draft: ActivityDraft
  onDraftChange: (draft: ActivityDraft) => void
  /** Label for the duration row in edit mode (e.g. "In Bed" for sleep). Defaults to "Duration". */
  durationLabel?: string
  /** Icon (emoji or URL) to display next to the title. */
  icon?: string
  /** Optional link URL for the title. */
  titleHref?: string
}

export const EditableActivityFields = ({
  title,
  isEditing,
  draft,
  onDraftChange,
  durationLabel = 'Duration',
  icon,
  titleHref,
}: EditableActivityFieldsProps) => {
  if (isEditing) {
    const draftStart = new Date(draft.start_time)
    const draftEnd = draft.end_time ? new Date(draft.end_time) : null
    const draftDuration =
      !draftEnd || isNaN(draftStart.getTime()) || isNaN(draftEnd.getTime())
        ? '—'
        : formatDuration(draftStart, draftEnd)

    return (
      <>
        <input
          type="text"
          class="edit-title-input"
          value={draft.title}
          onInput={(e) => onDraftChange({ ...draft, title: (e.target as HTMLInputElement).value })}
        />

        <div class="entity-fields" style={{ marginBottom: '0.5rem' }}>
          <div class="field-row">
            <span class="field-label">Type</span>
            <span class="field-value">
              <ActivityTypePicker
                value={draft.activity_type}
                onChange={(activity_type) => onDraftChange({ ...draft, activity_type })}
                placeholder="Search activity types..."
              />
            </span>
          </div>
        </div>

        <div class="entity-fields">
          <div class="field-row">
            <span class="field-label">Start</span>
            <span class="field-value">
              <input
                type="datetime-local"
                class="edit-datetime-input"
                value={draft.start_time}
                onInput={(e) => onDraftChange({ ...draft, start_time: (e.target as HTMLInputElement).value })}
              />
            </span>
          </div>
          <div class="field-row">
            <span class="field-label">End</span>
            <span class="field-value" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {draft.end_time ? (
                <>
                  <input
                    type="datetime-local"
                    class="edit-datetime-input"
                    value={draft.end_time}
                    onInput={(e) =>
                      onDraftChange({ ...draft, end_time: (e.target as HTMLInputElement).value })
                    }
                  />
                  <button
                    type="button"
                    class="btn-secondary"
                    title="Remove end time"
                    onClick={() => onDraftChange({ ...draft, end_time: '' })}
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
                  >
                    &times;
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  class="btn-secondary"
                  onClick={() => {
                    const start = new Date(draft.start_time)
                    const end = new Date(start.getTime() + 60 * 60000)
                    const pad = (n: number) => String(n).padStart(2, '0')
                    const formatted = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}`
                    onDraftChange({ ...draft, end_time: formatted })
                  }}
                >
                  Set end time
                </button>
              )}
            </span>
          </div>
          <div class="field-row">
            <span class="field-label">{durationLabel}</span>
            <span class="field-value">{draftDuration}</span>
          </div>
        </div>

        <div class="edit-notes-block">
          <span class="field-label">Notes</span>
          <textarea
            class="edit-notes-input"
            value={draft.notes}
            onInput={(e) => onDraftChange({ ...draft, notes: (e.target as HTMLTextAreaElement).value })}
            rows={3}
          />
        </div>
      </>
    )
  }

  const titleContent = titleHref ? (
    <a href={titleHref} class="entity-meta-link">
      {title}
    </a>
  ) : (
    title
  )

  // Read-only mode: render only the title. Parent renders the unified stats
  // table (Time, Duration, Distance, etc.) and any Notes block.
  return (
    <h2 class="entity-title-with-icon">
      {icon && <IconPreview icon={icon} size={28} />}
      {titleContent}
    </h2>
  )
}
