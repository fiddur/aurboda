import { useCallback, useRef, useState } from 'preact/hooks'

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
}

const PictureIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8" />
    <circle cx="8.5" cy="9.5" r="1.8" fill="currentColor" />
    <path d="M4 18l5.5-5.5 3.5 3.5 2.5-2.5L20 18" fill="none" stroke="currentColor" stroke-width="1.8" />
  </svg>
)

const PictureButton = ({ pictures }: { pictures: ImageUpload }) => (
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
        pictures.take(chosen)
      }}
    />
  </label>
)

const PictureStatus = ({ pictures }: { pictures: ImageUpload }) => (
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
      Paste, drop or pick a picture to add it. Describe it between the square brackets.
    </p>
  </div>
)

export const MarkdownEditor = ({ value, onChange, placeholder, rows = 4, upload }: MarkdownEditorProps) => {
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const textarea = useRef<HTMLTextAreaElement>(null)
  const pictures = useImageUpload({
    cursor: () => textarea.current?.selectionStart,
    onChange,
    upload,
    value,
  })

  const handleInput = useCallback(
    (e: Event) => {
      onChange((e.target as HTMLTextAreaElement).value)
    },
    [onChange],
  )

  const rendered = tab === 'preview' ? renderMarkdown(value || '*Nothing to preview*') : ''

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
          {pictures.enabled && tab === 'write' && <PictureButton pictures={pictures} />}
        </div>

        {tab === 'write' ? (
          <textarea
            ref={textarea}
            class="md-editor-textarea"
            value={value}
            onInput={handleInput}
            placeholder={placeholder ?? 'Write a note (markdown supported)…'}
            rows={rows}
            {...(pictures.enabled ? pictures.handlers : {})}
          />
        ) : (
          <div class="md-editor-preview" dangerouslySetInnerHTML={{ __html: rendered as string }} />
        )}
      </div>
      {pictures.enabled && <PictureStatus pictures={pictures} />}
    </>
  )
}
