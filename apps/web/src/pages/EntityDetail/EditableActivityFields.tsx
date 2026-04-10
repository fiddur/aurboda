/**
 * Shared component that renders activity title, time, duration, and notes
 * in either read mode (plain text) or edit mode (input fields).
 */
import type { ActivityTypeDefinition } from '../../state/api'

import { IconPreview } from '../../components/IconPreview'
import { toDisplayName } from '../../utils/displayName'
import { formatDateTime, formatDuration, formatTime } from './format-utils'

export interface ActivityDraft {
  activity_type: string
  title: string
  start_time: string // yyyy-MM-ddTHH:mm for datetime-local
  end_time: string
  notes: string
  exercise_type?: string
  data?: Record<string, unknown>
}

interface EditableActivityFieldsProps {
  title: string
  displayStart: Date
  displayEnd?: Date
  notes?: string
  isEditing: boolean
  draft: ActivityDraft
  onDraftChange: (draft: ActivityDraft) => void
  /** All available activity type definitions for the type selector. */
  typeDefinitions?: ActivityTypeDefinition[]
  /** Label for the duration row (e.g. "In Bed" for sleep). Defaults to "Duration". */
  durationLabel?: string
  /** Icon (emoji or URL) to display next to the title. */
  icon?: string
  /** Optional link URL for the title. */
  titleHref?: string
}

export const EditableActivityFields = ({
  title,
  displayStart,
  displayEnd,
  notes,
  isEditing,
  draft,
  onDraftChange,
  typeDefinitions,
  durationLabel = 'Duration',
  icon,
  titleHref,
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

        {typeDefinitions && (
          <div class="entity-fields" style={{ marginBottom: '0.5rem' }}>
            <div class="field-row">
              <span class="field-label">Type</span>
              <span class="field-value">
                <select
                  class="edit-datetime-input"
                  value={draft.activity_type}
                  onChange={(e) =>
                    onDraftChange({ ...draft, activity_type: (e.target as HTMLSelectElement).value })
                  }
                >
                  {typeDefinitions.map((def) => (
                    <option key={def.name} value={def.name}>
                      {def.display_name || toDisplayName(def.name)}
                    </option>
                  ))}
                </select>
              </span>
            </div>
          </div>
        )}

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

  const titleContent = titleHref ? (
    <a href={titleHref} class="entity-meta-link">
      {title}
    </a>
  ) : (
    title
  )

  return (
    <>
      <h2 class="entity-title-with-icon">
        {icon && <IconPreview icon={icon} size={28} />}
        {titleContent}
      </h2>

      <div class="entity-fields">
        <div class="field-row">
          <span class="field-label">Time</span>
          <span class="field-value">
            {displayEnd
              ? `${formatDateTime(displayStart)} – ${formatTime(displayEnd)}`
              : formatDateTime(displayStart)}
          </span>
        </div>
        {displayEnd && (
          <div class="field-row">
            <span class="field-label">{durationLabel}</span>
            <span class="field-value">{formatDuration(displayStart, displayEnd)}</span>
          </div>
        )}
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
