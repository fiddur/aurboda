import type { Tag } from '../../state/api'

/**
 * Tag detail view.
 */
import { IconPreview } from '../../components/IconPreview'
import { resolveItemIcon, suggestEmoji } from '../../utils/emojiLookup'
import { formatDateTime, formatDuration, formatTime } from './format-utils'

export const TagDetail = ({ tag, itemIcons }: { tag: Tag; itemIcons: Record<string, string> }) => {
  const end = tag.end_time
  const isPoint = !end
  const tagMetaKey = tag.tag_key ?? tag.tag
  const icon =
    resolveItemIcon(tag.tag, itemIcons) ??
    (tag.tag_key ? resolveItemIcon(tag.tag_key, itemIcons) : undefined) ??
    suggestEmoji(tag.tag)

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
