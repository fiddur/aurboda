import type { FeedVisibility } from '@aurboda/api-spec'

import { feedPostMessageMaxLength } from '@aurboda/api-spec'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'preact/hooks'

import { ExerciseShareContent } from '../pages/Feed/ExerciseShareContent'
import { apiErrorMessage, previewExerciseShare, shareExercise } from '../state/api'
import { buildExerciseShareBody, exerciseSharePreviewKey } from './exercise-share-body'
import { formatTagsInput, parseTagsInput } from './hashtags'
import { TagsInput } from './TagsInput'
import { FEED_VISIBILITY_OPTIONS, VisibilitySelector } from './VisibilitySelector'
import './ShareActivityDialog.css'

interface Props {
  activityType: string
  field: string
  value: string
  /** The published page's URL; only a published exercise can be linked. */
  publishedUrl?: string
  onClose: () => void
}

const Checkbox = ({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) => (
  <label class="share-dialog-checkbox">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
    />
    {label}
  </label>
)

export function ShareExerciseDialog({ activityType, field, value, publishedUrl, onClose }: Props) {
  const queryClient = useQueryClient()
  const [message, setMessage] = useState('')
  const [visibility, setVisibility] = useState<FeedVisibility>('public')
  const [includeRecords, setIncludeRecords] = useState(true)
  const [includeChart, setIncludeChart] = useState(true)
  const [includeSessions, setIncludeSessions] = useState(false)
  const [includeLink, setIncludeLink] = useState(true)
  const [tagsText, setTagsText] = useState('')
  const [tagsEdited, setTagsEdited] = useState(false)

  const body = buildExerciseShareBody({
    activityType,
    field,
    includeChart,
    includeLink,
    includeRecords,
    includeSessions,
    message,
    published: publishedUrl !== undefined,
    tags: tagsEdited ? parseTagsInput(tagsText) : undefined,
    value,
    visibility,
  })

  const [debouncedKey, setDebouncedKey] = useState('')
  const previewKey = exerciseSharePreviewKey(body)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKey(previewKey), 400)
    return () => clearTimeout(timer)
  }, [previewKey])
  const previewQuery = useQuery({
    enabled: debouncedKey !== '',
    placeholderData: keepPreviousData,
    queryFn: () => previewExerciseShare(JSON.parse(debouncedKey)),
    queryKey: ['exercise-share-preview', activityType, field, value, debouncedKey],
    staleTime: 60_000,
  })
  const preview = previewQuery.data
  const previewTags = preview?.tags
  useEffect(() => {
    if (!tagsEdited && previewTags) setTagsText(formatTagsInput(previewTags))
  }, [previewTags?.join(' ')])

  const mutation = useMutation({
    mutationFn: () => shareExercise(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed'] })
      onClose()
    },
  })

  return (
    <div class="share-dialog-backdrop" onClick={onClose}>
      <div
        class="share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-exercise-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="share-dialog-header">
          <h2 id="share-exercise-title">Share to feed</h2>
          <button type="button" class="share-dialog-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p class="share-dialog-subtitle">
          Post <strong>{value}</strong>'s progress to your feed. Followers see the numbers as they are now;
          nothing else from the sessions goes with it.
        </p>

        <fieldset class="share-dialog-group">
          <legend>Message</legend>
          <textarea
            class="share-dialog-message"
            rows={3}
            maxLength={feedPostMessageMaxLength}
            value={message}
            onInput={(e) => setMessage((e.target as HTMLTextAreaElement).value)}
            placeholder="Say something about it (optional)"
          />
          <p class="share-dialog-note">Markdown works.</p>
        </fieldset>

        <fieldset class="share-dialog-group">
          <legend>Included data</legend>
          <div class="share-dialog-options">
            <Checkbox
              checked={includeRecords}
              label="Records and session count"
              onChange={setIncludeRecords}
            />
            <Checkbox
              checked={includeChart}
              label="Trend chart — weekly bests and the decaying best; a trend image is attached for Mastodon"
              onChange={setIncludeChart}
            />
            <Checkbox checked={includeSessions} label="Last 5 sessions' sets" onChange={setIncludeSessions} />
            {publishedUrl !== undefined && (
              <Checkbox checked={includeLink} label="Link the public page" onChange={setIncludeLink} />
            )}
          </div>
          {publishedUrl === undefined && (
            <p class="share-dialog-note">Publish the exercise to link its public page from the post.</p>
          )}
        </fieldset>

        <fieldset class="share-dialog-group">
          <legend>Preview</legend>
          {previewQuery.isError ? (
            <p class="share-dialog-error">{apiErrorMessage(previewQuery.error, 'Preview unavailable.')}</p>
          ) : preview?.structured ? (
            <ExerciseShareContent structured={preview.structured} />
          ) : (
            <p class="share-dialog-note">Loading preview…</p>
          )}
          {preview?.content && (
            <details class="share-dialog-plain">
              <summary>As Mastodon sees it</summary>
              {/* The server's own HTML-escaped content of the user's own data, as in ShareActivityDialog. */}
              <div class="share-dialog-preview" dangerouslySetInnerHTML={{ __html: preview.content }} />
            </details>
          )}
        </fieldset>

        <TagsInput
          value={tagsText}
          onInput={(text) => {
            setTagsText(text)
            setTagsEdited(true)
          }}
        />

        <VisibilitySelector
          name="exercise-share-visibility"
          options={FEED_VISIBILITY_OPTIONS}
          value={visibility}
          onChange={setVisibility}
        />

        {mutation.error && (
          <p class="share-dialog-error">{apiErrorMessage(mutation.error, 'Failed to share')}</p>
        )}

        <div class="share-dialog-actions">
          <button type="button" class="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            class="btn-primary"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Sharing…' : 'Share'}
          </button>
        </div>
      </div>
    </div>
  )
}
