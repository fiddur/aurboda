import type { NoteAttachment } from '@aurboda/api-spec'

import { useEffect, useRef, useState } from 'preact/hooks'

import { fetchNoteAttachmentBlob } from '../../state/api'
import { pictureOrder, pictureStep, resolveInlinePictures, withoutInline } from './inline-pictures'

/**
 * An attachment's bytes as an object URL: fetched with the token (an `<img src>` cannot send it)
 * and revoked when the component goes.
 */
export const useAttachmentUrl = (
  noteId: string,
  attachmentId: string,
  maxEdge?: '400' | '2000',
): { url?: string; failed: boolean } => {
  const [state, setState] = useState<{ url?: string; failed: boolean }>({ failed: false })
  useEffect(() => {
    let url: string | undefined
    let cancelled = false
    setState({ failed: false })
    fetchNoteAttachmentBlob(noteId, attachmentId, maxEdge)
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setState({ failed: false, url })
      })
      .catch(() => {
        if (!cancelled) setState({ failed: true })
      })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [noteId, attachmentId, maxEdge])
  return state
}

/**
 * Fills in the pictures the rendered text (`html`, inside `container`) shows in place; a click on one
 * hands its attachment id to `onOpen`. Nothing to fetch before the entry has an id.
 */
export const useInlinePictures = (
  container: { current: HTMLElement | null },
  noteId: string | undefined,
  html: string,
  maxEdge: '400' | '2000',
  onOpen?: (attachmentId: string) => void,
) => {
  const openRef = useRef(onOpen)
  openRef.current = onOpen
  useEffect(() => {
    const node = container.current
    if (!node || !noteId) return
    return resolveInlinePictures(node, {
      fetchBlob: fetchNoteAttachmentBlob,
      maxEdge,
      noteId,
      onOpen: (id) => openRef.current?.(id),
    })
  }, [container, noteId, html, maxEdge])
}

const STEP_KEYS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 }

/**
 * One picture full size, stepping to the entry's other `pictureIds` with the arrow keys or the
 * buttons. The keys are taken in the capture phase so they do not also step to another entry.
 */
export const PictureViewer = ({
  noteId,
  attachmentId,
  pictureIds = [],
  onClose,
}: {
  noteId: string
  attachmentId: string
  pictureIds?: readonly string[]
  onClose: () => void
}) => {
  const [current, setCurrent] = useState(attachmentId)
  const { url, failed } = useAttachmentUrl(noteId, current, '2000')
  const previous = pictureStep(pictureIds, current, -1).target
  const { count, index, target: next } = pictureStep(pictureIds, current, 1)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return onClose()
      const delta = STEP_KEYS[event.key]
      if (!delta || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      event.preventDefault()
      event.stopPropagation()
      const target = delta < 0 ? previous : next
      if (target) setCurrent(target)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, previous, next])
  const step = (target: string) => (event: MouseEvent) => {
    event.stopPropagation()
    setCurrent(target)
  }
  return (
    <div class="journal-viewer" role="dialog" aria-label="Picture" onClick={onClose}>
      {url ? (
        <img src={url} alt="" />
      ) : (
        <p>{failed ? 'The picture could not be loaded.' : 'Loading the picture…'}</p>
      )}
      {count > 1 && (
        <>
          {previous && (
            <button
              type="button"
              class="journal-viewer-step journal-viewer-previous"
              onClick={step(previous)}
              aria-label="Previous picture"
            >
              ‹
            </button>
          )}
          {next && (
            <button
              type="button"
              class="journal-viewer-step journal-viewer-next"
              onClick={step(next)}
              aria-label="Next picture"
            >
              ›
            </button>
          )}
          <span class="journal-viewer-count">
            {index + 1} / {count}
          </span>
        </>
      )}
      <button type="button" class="journal-viewer-close" onClick={onClose} aria-label="Close">
        ✕
      </button>
    </div>
  )
}

export const PictureThumb = ({
  noteId,
  attachment,
  onOpen,
  label,
}: {
  noteId: string
  attachment: NoteAttachment
  onOpen: () => void
  label: string
}) => {
  const { url, failed } = useAttachmentUrl(noteId, attachment.id, '400')
  return (
    <button type="button" class="journal-thumb" onClick={onOpen} aria-label={label} title={label}>
      {url ? <img src={url} alt="" /> : <span>{failed ? '⚠' : ''}</span>}
    </button>
  )
}

export const RecordingPlayer = ({ noteId, attachment }: { noteId: string; attachment: NoteAttachment }) => {
  const { url, failed } = useAttachmentUrl(noteId, attachment.id)
  if (failed) return <p class="journal-muted">The recording could not be loaded.</p>
  return url ? (
    <audio class="journal-audio" controls preload="metadata" src={url} />
  ) : (
    <p class="journal-muted">Loading the recording…</p>
  )
}

/**
 * An entry's pictures as thumbnails (each opens the full picture) and its recordings as players;
 * pictures the text (`content`) already shows in place are left out.
 */
export const AttachmentStrip = ({
  noteId,
  attachments,
  content,
}: {
  noteId: string
  attachments: readonly NoteAttachment[]
  content: string
}) => {
  const [open, setOpen] = useState<NoteAttachment | undefined>(undefined)
  const pictures = withoutInline(
    attachments.filter((a) => a.kind === 'image'),
    content,
  )
  const recordings = attachments.filter((a) => a.kind === 'audio')
  if (pictures.length === 0 && recordings.length === 0) return null
  return (
    <div class="journal-attachments">
      {pictures.length > 0 && (
        <div class="journal-thumbs">
          {pictures.map((picture, index) => (
            <PictureThumb
              key={picture.id}
              noteId={noteId}
              attachment={picture}
              label={`Picture ${index + 1} of ${pictures.length}`}
              onOpen={() => setOpen(picture)}
            />
          ))}
        </div>
      )}
      {recordings.map((recording) => (
        <RecordingPlayer key={recording.id} noteId={noteId} attachment={recording} />
      ))}
      {open && (
        <PictureViewer
          noteId={noteId}
          attachmentId={open.id}
          pictureIds={pictureOrder(attachments, content)}
          onClose={() => setOpen(undefined)}
        />
      )}
    </div>
  )
}
