/**
 * Shared icon input — text field for emoji/URL, upload button, preview, and optional emoji suggestion.
 * Used by tag settings, exercise meta, timeline icon settings, screentime category detail,
 * and tag mappings settings.
 */
import { useRef, useState } from 'preact/hooks'

import { uploadIcon } from '../state/api'
import { isEmoji, isIconPath, isUrl } from '../utils/emojiLookup'
import './IconInput.css'

interface IconInputProps {
  /** Current icon value (emoji, URL, or icon path) */
  value: string
  /** Called when the icon value changes (from typing or upload) */
  onChange: (value: string) => void
  /** Called on blur (for auto-save patterns) */
  onBlur?: () => void
  /** Placeholder text */
  placeholder?: string
  /** Icon preview size in pixels */
  size?: number
  /** Suggested emoji to offer */
  suggestedEmoji?: string
  /** Called when a suggested emoji is accepted (some consumers auto-save on accept) */
  onAcceptSuggestion?: (emoji: string) => void
  /** CSS class for the text input */
  inputClass?: string
  /** CSS class for the preview span */
  previewClass?: string
  /** Disabled state */
  disabled?: boolean
}

export function IconInput({
  value,
  onChange,
  onBlur,
  placeholder = 'Emoji or image URL...',
  size = 24,
  suggestedEmoji,
  onAcceptSuggestion,
  inputClass,
  previewClass,
  disabled,
}: IconInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | undefined>(undefined)

  const handleFileUpload = async (file: File) => {
    setUploadError(undefined)
    setUploading(true)
    try {
      const { url } = await uploadIcon(file)
      onChange(url)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const isImage = value && (isUrl(value) || isIconPath(value))

  return (
    <>
      <input
        type="text"
        value={value}
        onInput={(e) => onChange((e.target as HTMLInputElement).value)}
        onBlur={onBlur}
        placeholder={placeholder}
        class={inputClass}
        disabled={disabled || uploading}
      />
      {value && (
        <span class={previewClass ?? 'icon-preview'}>
          {isEmoji(value) ? (
            value
          ) : isImage ? (
            <img src={value} alt="icon" width={size} height={size} />
          ) : null}
        </span>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = (e.target as HTMLInputElement).files?.[0]
          if (file) void handleFileUpload(file)
        }}
      />
      <button
        type="button"
        class="icon-upload-btn"
        onClick={() => fileInputRef.current?.click()}
        title="Upload icon image"
        disabled={disabled || uploading}
      >
        {uploading ? '...' : 'Upload'}
      </button>
      {suggestedEmoji && !value && (
        <button
          type="button"
          class="icon-suggestion-btn"
          onClick={() => {
            onChange(suggestedEmoji)
            onAcceptSuggestion?.(suggestedEmoji)
          }}
          title={`Suggested: ${suggestedEmoji}`}
        >
          {suggestedEmoji}?
        </button>
      )}
      {uploadError && <span class="icon-upload-error">{uploadError}</span>}
    </>
  )
}
