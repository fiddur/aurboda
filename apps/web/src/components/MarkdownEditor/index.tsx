import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'

import type { ImageUpload, UploadImage } from './image-upload'

import { renderMarkdown } from '../../utils/markdown'
import { useImageUpload } from './image-upload'
import './style.css'

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  upload?: UploadImage
  /** What to say when `upload` fails, in place of the feed-picture wording. */
  uploadFailureMessage?: (failure: unknown) => string
  /** Shown under the editor in place of the usual hint on adding pictures. */
  pictureHint?: string
  /**
   * Runs on the shown preview after each render of it (to fill in what the markdown cannot carry);
   * answers its cleanup.
   */
  decoratePreview?: (container: HTMLElement) => (() => void) | void
  /** Called when the text area loses focus. */
  onBlur?: () => void
  ariaLabel?: string
  /** Given the text area, for a caller that reads or moves the cursor. */
  textareaRef?: { current: HTMLTextAreaElement | null }
  /** Runs before the text area's own key handling; `preventDefault` stops it. */
  onKeyDown?: (e: KeyboardEvent) => void
  /** The cursor may have moved without the text changing (a click, an arrow key). */
  onCaret?: () => void
  /** The text area grows with its text instead of scrolling inside; `rows` is then its least height. */
  autoGrow?: boolean
}

const fitHeight = (textarea: HTMLTextAreaElement) => {
  const borders = textarea.offsetHeight - textarea.clientHeight
  const scrollY = window.scrollY
  textarea.style.height = 'auto'
  textarea.style.height = `${textarea.scrollHeight + borders}px`
  // Collapsing to `auto` for the measurement can shorten the page and clamp its scroll.
  if (window.scrollY !== scrollY) window.scrollTo(window.scrollX, scrollY)
}

const useAutoGrow = (
  textarea: { current: HTMLTextAreaElement | null },
  enabled: boolean | undefined,
  value: string,
  tab: string,
): string => {
  useLayoutEffect(() => {
    if (enabled && textarea.current) fitHeight(textarea.current)
  }, [enabled, textarea, value, tab])

  useLayoutEffect(() => {
    if (!enabled) return
    let width = window.innerWidth
    const refit = () => {
      if (window.innerWidth === width) return
      width = window.innerWidth
      if (textarea.current) fitHeight(textarea.current)
    }
    window.addEventListener('resize', refit)
    return () => window.removeEventListener('resize', refit)
  }, [enabled, textarea])

  return enabled ? 'md-editor-textarea md-editor-textarea--grow' : 'md-editor-textarea'
}

const PictureIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8" />
    <circle cx="8.5" cy="9.5" r="1.8" fill="currentColor" />
    <path d="M4 18l5.5-5.5 3.5 3.5 2.5-2.5L20 18" fill="none" stroke="currentColor" stroke-width="1.8" />
  </svg>
)

const PictureButton = ({ take }: { take: (files: File[]) => void }) => (
  <label class="md-editor-picture" title="Add a picture">
    <PictureIcon />
    <input
      type="file"
      class="md-editor-visually-hidden"
      accept="image/png,image/jpeg,image/webp,image/gif"
      multiple
      aria-label="Add a picture"
      onChange={(e) => {
        const input = e.currentTarget
        const chosen = [...(input.files ?? [])]
        input.value = ''
        take(chosen)
      }}
    />
  </label>
)

const PictureStatus = ({ pictures, hint }: { pictures: ImageUpload; hint: string | undefined }) => (
  <div class="md-editor-pictures">
    {pictures.sending > 0 && (
      <p class="md-editor-sending">{pictures.sending === 1 ? 'Sending a picture…' : 'Sending pictures…'}</p>
    )}
    {pictures.error && (
      <p class="md-editor-error" role="alert">
        {pictures.error}
      </p>
    )}
    <p class="md-editor-hint">
      {hint ?? 'Paste, drop or pick a picture to add it. Describe it between the square brackets.'}
    </p>
  </div>
)

const useDecoratedPreview = (
  preview: { current: HTMLDivElement | null },
  rendered: string,
  decorate: MarkdownEditorProps['decoratePreview'],
) => {
  const decorateRef = useRef(decorate)
  decorateRef.current = decorate
  useEffect(() => {
    const node = preview.current
    if (!node || !rendered) return
    return decorateRef.current?.(node) ?? undefined
  }, [preview, rendered])
}

export const MarkdownEditor = ({
  value,
  onChange,
  placeholder,
  rows = 4,
  upload,
  uploadFailureMessage,
  pictureHint,
  decoratePreview,
  onBlur,
  ariaLabel,
  textareaRef,
  onKeyDown,
  onCaret,
  autoGrow,
}: MarkdownEditorProps) => {
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const ownTextarea = useRef<HTMLTextAreaElement>(null)
  const textarea = textareaRef ?? ownTextarea
  const preview = useRef<HTMLDivElement>(null)
  const pictures = useImageUpload({
    cursor: () => textarea.current?.selectionStart,
    failureMessage: uploadFailureMessage,
    onChange,
    upload,
    value,
  })
  const textareaClass = useAutoGrow(textarea, autoGrow, value, tab)

  const handleInput = useCallback(
    (e: Event) => {
      onChange((e.target as HTMLTextAreaElement).value)
    },
    [onChange],
  )

  const rendered = tab === 'preview' ? renderMarkdown(value || '*Nothing to preview*') : ''
  useDecoratedPreview(preview, rendered, decoratePreview)

  return (
    <>
      <div class="md-editor">
        <div class="md-editor-tabs">
          <button
            class={`md-editor-tab ${tab === 'write' ? 'active' : ''}`}
            onClick={() => setTab('write')}
            type="button"
          >
            Write
          </button>
          <button
            class={`md-editor-tab ${tab === 'preview' ? 'active' : ''}`}
            onClick={() => setTab('preview')}
            type="button"
          >
            Preview
          </button>
          {pictures.enabled && tab === 'write' && <PictureButton take={pictures.take} />}
        </div>

        {tab === 'write' ? (
          <textarea
            ref={textarea}
            class={textareaClass}
            value={value}
            onInput={handleInput}
            placeholder={placeholder ?? 'Write a note (markdown supported)…'}
            rows={rows}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            onKeyUp={onCaret}
            onClick={onCaret}
            aria-label={ariaLabel}
            {...(pictures.enabled ? pictures.handlers : {})}
          />
        ) : (
          <div
            ref={preview}
            class="md-editor-preview"
            dangerouslySetInnerHTML={{ __html: rendered as string }}
          />
        )}
      </div>
      {pictures.enabled && <PictureStatus pictures={pictures} hint={pictureHint} />}
    </>
  )
}
