import type { NoteAttachment } from '@aurboda/api-spec'

import { useEffect, useState } from 'preact/hooks'

import { fetchNoteAttachmentBlob } from '../../state/api'

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

export const PictureViewer = ({
  noteId,
  attachment,
  onClose,
}: {
  noteId: string
  attachment: NoteAttachment
  onClose: () => void
}) => {
  const { url, failed } = useAttachmentUrl(noteId, attachment.id, '2000')
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div class="journal-viewer" role="dialog" aria-label="Picture" onClick={onClose}>
      {url ? (
        <img src={url} alt="" />
      ) : (
        <p>{failed ? 'The picture could not be loaded.' : 'Loading the picture…'}</p>
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

/** An entry's pictures as thumbnails (each opens the full picture) and its recordings as players. */
export const AttachmentStrip = ({
  noteId,
  attachments,
}: {
  noteId: string
  attachments: readonly NoteAttachment[]
}) => {
  const [open, setOpen] = useState<NoteAttachment | undefined>(undefined)
  const pictures = attachments.filter((a) => a.kind === 'image')
  const recordings = attachments.filter((a) => a.kind === 'audio')
  if (attachments.length === 0) return null
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
      {open && <PictureViewer noteId={noteId} attachment={open} onClose={() => setOpen(undefined)} />}
    </div>
  )
}
