import { ATTACHMENT_SCHEME, attachmentIdOf, UUID_PATTERN } from '../../utils/attachment-ref'

export const attachmentImageMarkdown = (id: string): string => `![](${ATTACHMENT_SCHEME}${id})`

const INLINE_IMAGE = new RegExp(`!\\[[^\\]]*\\]\\(${ATTACHMENT_SCHEME}(${UUID_PATTERN})\\)`, 'gi')

/** The attachments the text shows as pictures in place, by id (lower-cased). */
export const inlineAttachmentIds = (content: string): Set<string> =>
  new Set([...content.matchAll(INLINE_IMAGE)].map(([, id = '']) => id.toLowerCase()))

/** The attachments the text does not show in place, in their order: those go in the strip below it. */
export const withoutInline = <T extends { id: string }>(attachments: readonly T[], content: string): T[] => {
  const inline = inlineAttachmentIds(content)
  return attachments.filter((attachment) => !inline.has(attachment.id.toLowerCase()))
}

export interface InlinePictureOptions {
  noteId: string
  maxEdge: '400' | '2000'
  fetchBlob: (noteId: string, attachmentId: string, maxEdge: '400' | '2000') => Promise<Blob>
  onOpen?: (attachmentId: string) => void
  objectUrls?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>
}

const missing = (img: HTMLImageElement) => {
  const note = img.ownerDocument.createElement('span')
  note.className = 'journal-muted'
  note.textContent = 'Picture missing'
  img.replaceWith(note)
}

const openable = (img: HTMLImageElement, id: string, onOpen: (attachmentId: string) => void) => {
  img.setAttribute('role', 'button')
  img.tabIndex = 0
  const click = () => onOpen(id)
  const key = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onOpen(id)
  }
  img.addEventListener('click', click)
  img.addEventListener('keydown', key)
  return () => {
    img.removeEventListener('click', click)
    img.removeEventListener('keydown', key)
  }
}

/**
 * Fills in every `img[data-attachment-id]` under `container` with the attachment's bytes, fetched with
 * the token. Answers the cleanup: it revokes the object URLs and ignores fetches still on their way.
 */
export const resolveInlinePictures = (
  container: HTMLElement,
  { noteId, maxEdge, fetchBlob, onOpen, objectUrls = URL }: InlinePictureOptions,
): (() => void) => {
  let cancelled = false
  const urls: string[] = []
  const detach: (() => void)[] = []
  const fetches = new Map<string, Promise<string>>()
  const urlFor = (id: string) => {
    let pending = fetches.get(id)
    if (!pending) {
      pending = fetchBlob(noteId, id, maxEdge).then((blob) => {
        const url = objectUrls.createObjectURL(blob)
        if (cancelled) objectUrls.revokeObjectURL(url)
        else urls.push(url)
        return url
      })
      fetches.set(id, pending)
    }
    return pending
  }

  for (const img of container.querySelectorAll<HTMLImageElement>('img[data-attachment-id]')) {
    const id = attachmentIdOf(`${ATTACHMENT_SCHEME}${img.dataset.attachmentId ?? ''}`)
    if (id === undefined) continue
    img.classList.add('journal-inline-picture')
    if (onOpen) detach.push(openable(img, id, onOpen))
    urlFor(id).then(
      (url) => {
        if (!cancelled) img.src = url
      },
      () => {
        if (!cancelled) missing(img)
      },
    )
  }

  return () => {
    cancelled = true
    for (const off of detach) off()
    for (const url of urls) objectUrls.revokeObjectURL(url)
  }
}
