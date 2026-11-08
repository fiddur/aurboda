import type { FeedVisibility } from '@aurboda/api-spec'

import { feedPostMessageMaxLength, periodLabel } from '@aurboda/api-spec'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'preact/hooks'

import { DashboardShareContent } from '../pages/Feed/DashboardShareContent'
import { apiErrorMessage, previewDashboardPeriodShare, shareDashboardPeriod } from '../state/api'
import { buildDashboardShareBody, dashboardSharePreviewKey } from './dashboard-share-body'
import { formatTagsInput, parseTagsInput } from './hashtags'
import { TagsInput } from './TagsInput'
import { FEED_VISIBILITY_OPTIONS, VisibilitySelector } from './VisibilitySelector'
import './ShareActivityDialog.css'

interface Props {
  /** The shared dashboard; left out for the home dashboard. */
  dashboardId?: string
  name: string
  /** The finished period to share. */
  period: string
  /** The published page's URL; only a published dashboard can be linked. */
  publishedUrl?: string
  onClose: () => void
}

export function ShareDashboardPeriodDialog({ dashboardId, name, period, publishedUrl, onClose }: Props) {
  const queryClient = useQueryClient()
  const [message, setMessage] = useState('')
  const [visibility, setVisibility] = useState<FeedVisibility>('public')
  const [includeLink, setIncludeLink] = useState(true)
  const [tagsText, setTagsText] = useState('')
  const [tagsEdited, setTagsEdited] = useState(false)

  const body = buildDashboardShareBody({
    dashboardId,
    includeLink,
    message,
    period,
    published: publishedUrl !== undefined,
    tags: tagsEdited ? parseTagsInput(tagsText) : undefined,
    visibility,
  })

  const [debouncedKey, setDebouncedKey] = useState('')
  const previewKey = dashboardSharePreviewKey(body)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKey(previewKey), 400)
    return () => clearTimeout(timer)
  }, [previewKey])
  const previewQuery = useQuery({
    enabled: debouncedKey !== '',
    placeholderData: keepPreviousData,
    queryFn: () => previewDashboardPeriodShare(JSON.parse(debouncedKey)),
    queryKey: ['dashboard-share-preview', dashboardId ?? 'home', debouncedKey],
    staleTime: 60_000,
  })
  const preview = previewQuery.data
  const previewTags = preview?.tags
  useEffect(() => {
    if (!tagsEdited && previewTags) setTagsText(formatTagsInput(previewTags))
  }, [previewTags?.join(' ')])

  const mutation = useMutation({
    mutationFn: () => shareDashboardPeriod(body),
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
        aria-labelledby="share-dashboard-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="share-dialog-header">
          <h2 id="share-dashboard-title">Share to feed</h2>
          <button type="button" class="share-dialog-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p class="share-dialog-subtitle">
          Post <strong>{name}</strong> for <strong>{periodLabel(period)}</strong> to your feed. The post keeps
          the dashboard as it is now, so later edits don't change it; nothing beyond its widgets goes with it.
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

        {publishedUrl !== undefined && (
          <fieldset class="share-dialog-group">
            <legend>Link</legend>
            <label class="share-dialog-checkbox">
              <input
                type="checkbox"
                checked={includeLink}
                onChange={(e) => setIncludeLink((e.target as HTMLInputElement).checked)}
              />
              Link the dashboard's public page
            </label>
          </fieldset>
        )}

        <fieldset class="share-dialog-group">
          <legend>Preview</legend>
          {previewQuery.isError ? (
            <p class="share-dialog-error">{apiErrorMessage(previewQuery.error, 'Preview unavailable.')}</p>
          ) : preview?.structured ? (
            <DashboardShareContent structured={preview.structured} />
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
          name="dashboard-share-visibility"
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
