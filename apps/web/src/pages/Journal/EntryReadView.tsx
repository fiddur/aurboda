import { useRef } from 'preact/hooks'

import { renderMarkdown } from '../../utils/markdown'
import { useInlinePictures } from './Attachments'

const hasSelection = () => (window.getSelection()?.toString() ?? '') !== ''

/**
 * The entry's text laid out for reading; a tap on it (not on a link or a picture, not a selection) or
 * Edit opens the editor. A tap on a picture in the text opens it full size.
 */
export const EntryReadView = ({
  content,
  noteId,
  onEdit,
  onOpenPicture,
}: {
  content: string
  noteId: string | undefined
  onEdit: () => void
  onOpenPicture: (attachmentId: string) => void
}) => {
  const text = useRef<HTMLDivElement>(null)
  const html = content.trim() === '' ? '' : renderMarkdown(content)
  useInlinePictures(text, noteId, html, '2000', onOpenPicture)
  return (
    <div
      class="journal-read"
      tabIndex={0}
      aria-label="Entry text, tap to edit"
      onClick={(e) => {
        if ((e.target as Element).closest('a, img[data-attachment-id]') || hasSelection()) return
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
      {html === '' ? (
        <p class="journal-muted journal-read-empty">Nothing written yet.</p>
      ) : (
        <div
          ref={text}
          class="md-editor-preview journal-read-text"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  )
}
