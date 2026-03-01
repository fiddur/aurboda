/**
 * Tag detail view.
 */
import type { Tag } from '../../state/api'
import { formatDateTime, formatDuration, formatTime } from './format-utils'

export const TagDetail = ({ tag }: { tag: Tag }) => {
  const end = tag.end_time
  const isPoint = !end

  return (
    <div class="entity-info">
      <div class="entity-meta">
        <span class="entity-type-badge">tag</span>
        {tag.source && <span class="entity-source">Source: {tag.source}</span>}
      </div>

      <h2>{tag.tag}</h2>

      <div class="entity-fields">
        <div class="field-row">
          <span class="field-label">Time</span>
          <span class="field-value">
            {isPoint ?
              formatDateTime(tag.start_time)
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
