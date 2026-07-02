/**
 * Publish an activity to the user's federated feed (or edit an existing feed
 * post). The user picks which scalar summaries to share, optionally opts into
 * sharing full high-resolution series (a separate, more-revealing choice), and
 * sets the audience.
 *
 * Passing `post` switches the dialog to edit mode (PATCH); otherwise it shares
 * the activity (POST). Only the metric keys the backend can resolve are offered
 * — unavailable ones are silently dropped server-side, so the same set is safe
 * to show for every activity.
 */
import type { FeedPost, FeedVisibility, MetricType } from '@aurboda/api-spec'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { shareActivity, updateFeedPost } from '../state/api'
import './ShareActivityDialog.css'

interface Props {
  activityId: string
  activityTitle?: string
  /** When present, edit this existing post instead of sharing anew. */
  post?: FeedPost
  onClose: () => void
  onShared?: (post: FeedPost) => void
}

/** Scalar summaries the backend knows how to resolve (see services/activitypub/scalars.ts). */
const SUMMARY_METRICS: { key: string; label: string }[] = [
  { key: 'duration', label: 'Duration' },
  { key: 'distance', label: 'Distance' },
  { key: 'heart_rate_avg', label: 'Avg HR' },
  { key: 'heart_rate_max', label: 'Max HR' },
  { key: 'hr_zone_minutes', label: 'HR zones' },
  { key: 'calories', label: 'Calories' },
  { key: 'stress_avg', label: 'Avg stress' },
]

/** High-resolution series a user can explicitly opt into sharing. */
const SERIES_METRICS: { key: MetricType; label: string }[] = [
  { key: 'heart_rate', label: 'Heart rate' },
  { key: 'speed', label: 'Speed' },
  { key: 'power', label: 'Power' },
  { key: 'elevation', label: 'Elevation' },
  { key: 'run_cadence', label: 'Cadence' },
  { key: 'stress_level', label: 'Stress' },
]

const VISIBILITIES: { value: FeedVisibility; label: string; hint: string }[] = [
  { hint: 'Anyone can see it; appears in public timelines.', label: 'Public', value: 'public' },
  { hint: 'Anyone with the link; kept out of public timelines.', label: 'Unlisted', value: 'unlisted' },
  { hint: 'Only your followers.', label: 'Followers only', value: 'followers' },
]

const DEFAULT_SUMMARY = ['duration', 'distance', 'heart_rate_avg', 'heart_rate_max', 'calories']

const toggle = <T extends string>(set: Set<T>, key: T): Set<T> => {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

export function ShareActivityDialog({ activityId, activityTitle, post, onClose, onShared }: Props) {
  const queryClient = useQueryClient()
  const [summary, setSummary] = useState<Set<string>>(
    () => new Set(post ? post.included_metrics : DEFAULT_SUMMARY),
  )
  // Preselect from the post's shared series, intersected with the keys this
  // dialog can represent — keeps the state typed as `Set<MetricType>` without a
  // cast (the dialog only offers `SERIES_METRICS` anyway).
  const [series, setSeries] = useState<Set<MetricType>>(
    () => new Set(SERIES_METRICS.map((m) => m.key).filter((k) => post?.series_metrics.includes(k) ?? false)),
  )
  const [visibility, setVisibility] = useState<FeedVisibility>(post?.visibility ?? 'public')

  const mutation = useMutation({
    mutationFn: () => {
      const included_metrics = [...summary]
      const series_metrics = [...series]
      // Edit mode leaves include_chart/include_map untouched (both optional on
      // UpdateFeedPostBody); only the create path sets their defaults.
      return post
        ? updateFeedPost(post.id, { included_metrics, series_metrics, visibility })
        : shareActivity(activityId, {
            include_chart: false,
            include_map: false,
            included_metrics,
            series_metrics,
            visibility,
          })
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['feed'] })
      onShared?.(result)
      onClose()
    },
  })

  return (
    <div class="share-dialog-backdrop" onClick={onClose}>
      <div class="share-dialog" onClick={(e) => e.stopPropagation()}>
        <div class="share-dialog-header">
          <h2>{post ? 'Edit shared post' : 'Share to feed'}</h2>
          <button type="button" class="share-dialog-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p class="share-dialog-subtitle">
          {post ? 'Editing' : 'Publish'} <strong>{activityTitle || 'this activity'}</strong>
          {post ? ' — followers get an update.' : ' to your federated feed.'}
        </p>

        <fieldset class="share-dialog-group">
          <legend>Summary metrics</legend>
          <div class="share-dialog-options">
            {SUMMARY_METRICS.map(({ key, label }) => (
              <label key={key} class="share-dialog-checkbox">
                <input
                  type="checkbox"
                  checked={summary.has(key)}
                  onChange={() => setSummary((s) => toggle(s, key))}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset class="share-dialog-group">
          <legend>Share full time-series</legend>
          <p class="share-dialog-note">Higher resolution — more revealing than a summary. Off by default.</p>
          <div class="share-dialog-options">
            {SERIES_METRICS.map(({ key, label }) => (
              <label key={key} class="share-dialog-checkbox">
                <input
                  type="checkbox"
                  checked={series.has(key)}
                  onChange={() => setSeries((s) => toggle(s, key))}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset class="share-dialog-group">
          <legend>Visibility</legend>
          {VISIBILITIES.map(({ value, label, hint }) => (
            <label key={value} class="share-dialog-radio">
              <input
                type="radio"
                name="visibility"
                checked={visibility === value}
                onChange={() => setVisibility(value)}
              />
              <span>
                <strong>{label}</strong>
                <span class="share-dialog-hint">{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {mutation.error && (
          <p class="share-dialog-error">
            {mutation.error instanceof Error ? mutation.error.message : 'Failed to share'}
          </p>
        )}

        <div class="share-dialog-actions">
          <button type="button" class="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            class="btn-primary"
            disabled={mutation.isPending || summary.size === 0}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Saving…' : post ? 'Save changes' : 'Share'}
          </button>
        </div>
      </div>
    </div>
  )
}
