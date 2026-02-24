/**
 * Shared component that renders activity title, time, duration, and notes
 * in either read mode (plain text) or edit mode (input fields).
 */
import { formatDateTime, formatDuration, formatTime } from './format-utils'

export interface ActivityDraft {
  title: string
  start_time: string // yyyy-MM-ddTHH:mm for datetime-local
  end_time: string
  notes: string
  exercise_type?: string
}

interface EditableActivityFieldsProps {
  title: string
  displayStart: Date
  displayEnd: Date
  notes?: string
  isEditing: boolean
  draft: ActivityDraft
  onDraftChange: (draft: ActivityDraft) => void
  /** Label for the duration row (e.g. "In Bed" for sleep). Defaults to "Duration". */
  durationLabel?: string
}

export const EditableActivityFields = ({
  title,
  displayStart,
  displayEnd,
  notes,
  isEditing,
  draft,
  onDraftChange,
  durationLabel = 'Duration',
}: EditableActivityFieldsProps) => {
  if (isEditing) {
    const draftStart = new Date(draft.start_time)
    const draftEnd = new Date(draft.end_time)
    const draftDuration =
      isNaN(draftStart.getTime()) || isNaN(draftEnd.getTime()) ? '—' : formatDuration(draftStart, draftEnd)

    return (
      <>
        <input
          type="text"
          class="edit-title-input"
          value={draft.title}
          onInput={(e) => onDraftChange({ ...draft, title: (e.target as HTMLInputElement).value })}
        />

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
            <span class="field-value">
              <input
                type="datetime-local"
                class="edit-datetime-input"
                value={draft.end_time}
                onInput={(e) => onDraftChange({ ...draft, end_time: (e.target as HTMLInputElement).value })}
              />
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

  return (
    <>
      <h2>{title}</h2>

      <div class="entity-fields">
        <div class="field-row">
          <span class="field-label">Time</span>
          <span class="field-value">
            {formatDateTime(displayStart)} – {formatTime(displayEnd)}
          </span>
        </div>
        <div class="field-row">
          <span class="field-label">{durationLabel}</span>
          <span class="field-value">{formatDuration(displayStart, displayEnd)}</span>
        </div>
        {notes && (
          <div class="field-row">
            <span class="field-label">Notes</span>
            <span class="field-value">{notes}</span>
          </div>
        )}
      </div>
    </>
  )
}
