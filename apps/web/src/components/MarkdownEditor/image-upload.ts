import { MAX_FEED_IMAGES_PER_ACCOUNT } from '@aurboda/api-spec'
import { useRef, useState } from 'preact/hooks'

const PLACEHOLDER_PREFIX = '![Uploading '

export const uploadPlaceholder = (name: string): string => `${PLACEHOLDER_PREFIX}${name}…]()`

export const stillUploading = (value: string): boolean => value.includes(PLACEHOLDER_PREFIX)

export const freePlaceholder = (value: string, name: string): string => {
  let candidate = uploadPlaceholder(name)
  for (let attempt = 2; value.includes(candidate); attempt += 1) {
    candidate = uploadPlaceholder(`${name} (${attempt})`)
  }
  return candidate
}

export const insertAt = (value: string, at: number, text: string): string => {
  const cursor = Math.max(0, Math.min(at, value.length))
  return `${value.slice(0, cursor)}${text}${value.slice(cursor)}`
}

/**
 * Puts `text` at `at` on a line of its own, and answers where that line ends, so
 * a second picture goes in right after the first.
 */
export const insertOnOwnLine = (value: string, at: number, text: string): { value: string; end: number } => {
  const cursor = Math.max(0, Math.min(at, value.length))
  const before = value.slice(0, cursor)
  const after = value.slice(cursor)
  const lead = before === '' || before.endsWith('\n') ? '' : '\n'
  const trail = after.startsWith('\n') ? '' : '\n'
  return {
    end: cursor + lead.length + text.length + trail.length,
    value: `${before}${lead}${text}${trail}${after}`,
  }
}

export const replaceFirst = (value: string, find: string, replacement: string): string => {
  const at = value.indexOf(find)
  if (at === -1) return value
  return `${value.slice(0, at)}${replacement}${value.slice(at + find.length)}`
}

export const removePlaceholder = (value: string, placeholder: string): string =>
  value.includes(`${placeholder}\n`)
    ? replaceFirst(value, `${placeholder}\n`, '')
    : replaceFirst(value, placeholder, '')

export const imageMarkdown = (url: string): string => `![](${url})`

export const NOT_A_PICTURE = 'That is not a picture Aurboda can use. PNG, JPEG, WebP or GIF works.'

const statusOf = (failure: unknown): number | undefined =>
  typeof failure === 'object' && failure !== null && 'status' in failure && typeof failure.status === 'number'
    ? failure.status
    : undefined

const isNetworkFailure = (failure: unknown): boolean =>
  typeof failure === 'object' && failure !== null && 'network' in failure && failure.network === true

const MESSAGES_BY_STATUS: Record<number, string> = {
  401: 'You have been signed out. Sign in again and have another go.',
  409: `You have stored as many pictures as one account may hold (${MAX_FEED_IMAGES_PER_ACCOUNT}). Delete some first.`,
  413: 'That picture is too large to send.',
  415: NOT_A_PICTURE,
}

export const messageForFailure = (failure: unknown): string => {
  const status = statusOf(failure)
  if (status !== undefined && MESSAGES_BY_STATUS[status]) return MESSAGES_BY_STATUS[status]
  if (isNetworkFailure(failure)) return 'Could not reach Aurboda. Check the connection and try again.'
  return 'Could not send that picture. Please try again.'
}

export type UploadImage = (file: File) => Promise<{ url: string }>

const REFUSED_TYPE = 'image/svg+xml'

const imagesIn = (files: FileList | null | undefined): File[] =>
  [...(files ?? [])].filter((file) => file.type.startsWith('image/'))

export interface ImageUpload {
  enabled: boolean
  handlers: {
    onPaste: (event: ClipboardEvent) => void
    onDrop: (event: DragEvent) => void
    onDragOver: (event: DragEvent) => void
  }
  take: (files: readonly File[]) => void
  sending: number
  error: string | undefined
}

export const useImageUpload = ({
  value,
  onChange,
  upload,
  cursor,
}: {
  value: string
  onChange: (value: string) => void
  upload?: UploadImage
  cursor: () => number | undefined
}): ImageUpload => {
  const [sending, setSending] = useState(0)
  const [error, setError] = useState<string | undefined>(undefined)
  const latest = useRef(value)
  latest.current = value
  const latestOnChange = useRef(onChange)
  latestOnChange.current = onChange

  const write = (next: string) => {
    latest.current = next
    latestOnChange.current(next)
  }

  const send = async (file: File, placeholder: string, post: UploadImage) => {
    try {
      const { url } = await post(file)
      write(replaceFirst(latest.current, placeholder, imageMarkdown(url)))
    } catch (failure) {
      write(removePlaceholder(latest.current, placeholder))
      setError(messageForFailure(failure))
    }
  }

  const take = (files: readonly File[]) => {
    if (upload === undefined || files.length === 0) return
    setError(undefined)

    const usable = files.filter((file) => file.type !== REFUSED_TYPE)
    if (usable.length < files.length) setError(NOT_A_PICTURE)
    if (usable.length === 0) return

    let at = cursor() ?? latest.current.length
    const started = usable.map((file) => {
      const placeholder = freePlaceholder(latest.current, file.name === '' ? 'picture' : file.name)
      const placed = insertOnOwnLine(latest.current, at, placeholder)
      write(placed.value)
      at = placed.end
      return { file, placeholder }
    })

    setSending((sofar) => sofar + started.length)
    void Promise.all(started.map(({ file, placeholder }) => send(file, placeholder, upload))).finally(() => {
      setSending((sofar) => sofar - started.length)
    })
  }

  return {
    enabled: upload !== undefined,
    error,
    handlers: {
      onDragOver: (event) => {
        if (upload === undefined) return
        if (event.dataTransfer?.types.includes('Files') === true) event.preventDefault()
      },
      onDrop: (event) => {
        const pictures = upload === undefined ? [] : imagesIn(event.dataTransfer?.files)
        if (pictures.length === 0) return
        event.preventDefault()
        take(pictures)
      },
      onPaste: (event) => {
        const pictures = upload === undefined ? [] : imagesIn(event.clipboardData?.files)
        if (pictures.length === 0) return
        event.preventDefault()
        take(pictures)
      },
    },
    sending,
    take,
  }
}
