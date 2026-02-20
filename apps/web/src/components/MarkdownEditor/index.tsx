/**
 * Reusable Markdown editor with Write / Preview tabs.
 */
import { marked } from 'marked'
import { useCallback, useState } from 'preact/hooks'

import './style.css'

// Configure marked for safe rendering (no HTML passthrough)
marked.setOptions({
  breaks: true,
  gfm: true,
})

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
}

export const MarkdownEditor = ({ value, onChange, placeholder, rows = 4 }: MarkdownEditorProps) => {
  const [tab, setTab] = useState<'write' | 'preview'>('write')

  const handleInput = useCallback(
    (e: Event) => {
      onChange((e.target as HTMLTextAreaElement).value)
    },
    [onChange],
  )

  const rendered = tab === 'preview' ? marked.parse(value || '*Nothing to preview*') : ''

  return (
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
      </div>

      {tab === 'write' ?
        <textarea
          class="md-editor-textarea"
          value={value}
          onInput={handleInput}
          placeholder={placeholder ?? 'Write a note (markdown supported)…'}
          rows={rows}
        />
      : <div class="md-editor-preview" dangerouslySetInnerHTML={{ __html: rendered as string }} />}
    </div>
  )
}
