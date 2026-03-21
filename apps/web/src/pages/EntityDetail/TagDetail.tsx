import type { Tag } from '../../state/api'

/**
 * Tag detail view with optional edit mode for start/end times.
 */
import { IconPreview } from '../../components/IconPreview'
import { resolveItemIcon, suggestEmoji } from '../../utils/emojiLookup'
import { formatDateTime, formatDateTimeLocal, formatDuration, formatTime } from './format-utils'

export interface TagDraft {
  start_time: string // yyyy-MM-ddTHH:mm for datetime-local
  end_time: string
}

const resolveTagIcon = (tag: Tag, itemIcons: Record<string, string>) =>
  resolveItemIcon(tag.tag, itemIcons) ??
  (tag.tag_key ? resolveItemIcon(tag.tag_key, itemIcons) : undefined) ??
  suggestEmoji(tag.tag)

const TagEditView = ({
  tag,
  icon,
  draft,
  onDraftChange,
}: {
  tag: Tag
  icon?: string
  draft: TagDraft
  onDraftChange: (d: TagDraft) => void
}) => {
  const draftStart = new Date(draft.start_time)
  const draftEnd = draft.end_time ? new Date(draft.end_time) : undefined
  const hasDraftEnd = Boolean(draft.end_time)
  const draftDuration =
    hasDraftEnd && !isNaN(draftStart.getTime()) && !isNaN(draftEnd!.getTime())
      ? formatDuration(draftStart, draftEnd!)
      : undefined

  return (
    <div class="entity-info">
      <div class="entity-meta">
        <span class="entity-type-badge">tag</span>
        {tag.source && <span class="entity-source">Source: {tag.source}</span>}
      </div>

      <h2 class="entity-title-with-icon">
        {icon && <IconPreview icon={icon} size={28} />}
        {tag.tag}
      </h2>

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
            {hasDraftEnd ? (
              <input
                type="datetime-local"
                class="edit-datetime-input"
                value={draft.end_time}
                onInput={(e) => onDraftChange({ ...draft, end_time: (e.target as HTMLInputElement).value })}
              />
            ) : (
              <button
                class="btn-secondary"
                type="button"
                onClick={() => onDraftChange({ ...draft, end_time: formatDateTimeLocal(new Date()) })}
              >
                Set end time
              </button>
            )}
            {hasDraftEnd && (
              <button
                class="btn-secondary"
                type="button"
                style={{ marginLeft: '0.5rem' }}
                onClick={() => onDraftChange({ ...draft, end_time: '' })}
              >
                Clear
              </button>
            )}
          </span>
        </div>
        {draftDuration && (
          <div class="field-row">
            <span class="field-label">Duration</span>
            <span class="field-value">{draftDuration}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export const TagDetail = ({
  tag,
  itemIcons,
  isEditing = false,
  draft,
  onDraftChange,
}: {
  tag: Tag
  itemIcons: Record<string, string>
  isEditing?: boolean
  draft?: TagDraft
  onDraftChange?: (d: TagDraft) => void
}) => {
  const end = tag.end_time
  const isPoint = !end
  const tagMetaKey = tag.tag_key ?? tag.tag
  const icon = resolveTagIcon(tag, itemIcons)

  if (isEditing && draft && onDraftChange) {
    return <TagEditView tag={tag} icon={icon} draft={draft} onDraftChange={onDraftChange} />
  }

  return (
    <div class="entity-info">
      <div class="entity-meta">
        <span class="entity-type-badge">tag</span>
        {tag.source && <span class="entity-source">Source: {tag.source}</span>}
      </div>

      <h2 class="entity-title-with-icon">
        {icon && <IconPreview icon={icon} size={28} />}
        <a href={`/tag/${encodeURIComponent(tagMetaKey)}`} class="entity-meta-link">
          {tag.tag}
        </a>
      </h2>

      <div class="entity-fields">
        <div class="field-row">
          <span class="field-label">Time</span>
          <span class="field-value">
            {isPoint
              ? formatDateTime(tag.start_time)
              : `${formatDateTime(tag.start_time)} – ${formatTime(end!)}`}
          </span>
        </div>
        {!isPoint && (
          <div class="field-row">
            <span class="field-label">Duration</span>
            <span class="field-value">{formatDuration(tag.start_time, end!)}</span>
          </div>
        )}
        {isPoint && (
          <div class="field-row">
            <span class="field-label">Type</span>
            <span class="field-value">Point event</span>
          </div>
        )}
      </div>
    </div>
  )
}
