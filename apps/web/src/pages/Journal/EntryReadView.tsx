import { renderMarkdown } from '../../utils/markdown'

const hasSelection = () => (window.getSelection()?.toString() ?? '') !== ''

/** The entry's text laid out for reading; a tap on it (not on a link, not a selection) or Edit opens the editor. */
export const EntryReadView = ({ content, onEdit }: { content: string; onEdit: () => void }) => (
  <div
    class="journal-read"
    tabIndex={0}
    aria-label="Entry text, tap to edit"
    onClick={(e) => {
      if ((e.target as Element).closest('a') || hasSelection()) return
      onEdit()
    }}
    onKeyDown={(e) => {
      if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (e.key === 'Enter' || e.key === 'e') {
        e.preventDefault()
        onEdit()
      }
    }}
  >
    <button
      type="button"
      class="btn-secondary journal-read-edit"
      onClick={(e) => {
        e.stopPropagation()
        onEdit()
      }}
    >
      Edit
    </button>
    {content.trim() === '' ? (
      <p class="journal-muted journal-read-empty">Nothing written yet.</p>
    ) : (
      <div
        class="md-editor-preview journal-read-text"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
      />
    )}
  </div>
)
