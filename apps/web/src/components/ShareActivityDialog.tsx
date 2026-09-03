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

import { feedPostMessageMaxLength } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'preact/hooks'

import {
  fetchBucketedMetrics,
  fetchRawLocations,
  previewShare,
  shareActivity,
  updateFeedPost,
} from '../state/api'
import {
  buildShareBody,
  defaultsFromChart,
  initialSeriesSelection,
  SERIES_METRICS,
  SUMMARY_METRICS,
} from './feed-metrics'
import { FEED_VISIBILITY_OPTIONS, VisibilitySelector } from './VisibilitySelector'
import './ShareActivityDialog.css'

interface Props {
  activityId: string
  activityTitle?: string
  /** Activity window — when given, the dialog offers only metrics with data in it. */
  activityStart?: Date
  activityEnd?: Date
  /** Metrics currently shown on the activity's chart; mirrored into the defaults. */
  chartMetrics?: string[]
  /**
   * Prefill for the personal message (create mode) — typically the activity's
   * description/comments, shown editable so the user can redact before sharing.
   */
  defaultMessage?: string
  /** When present, edit this existing post instead of sharing anew. */
  post?: FeedPost
  onClose: () => void
  onShared?: (post: FeedPost) => void
}

const toggle = <T extends string>(set: Set<T>, key: T): Set<T> => {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

/**
 * Which summary/series options to offer for an activity: those whose source
 * metric has data in the given window (e.g. no Distance on a yoga session),
 * plus `keepSummary`/`keepSeries` — metrics the post already shares, always kept
 * so an edit over a narrower window can never silently drop an existing choice.
 * One coarse bucketed fetch; while it loads (or without a window) every option
 * is offered.
 */
// eslint-disable-next-line complexity -- availability gating across summary/series/chart/map
const useShareableMetricOptions = (
  activityStart?: Date,
  activityEnd?: Date,
  keepSummary: string[] = [],
  keepSeries: string[] = [],
  keepChart = false,
  keepMap = false,
) => {
  const availabilityQuery = useQuery({
    // The `??` fallbacks never run — `enabled` gates the fetch on both being set.
    enabled: activityStart != null && activityEnd != null,
    queryFn: () =>
      fetchBucketedMetrics(activityStart ?? new Date(), activityEnd ?? new Date(), undefined, '1h'),
    queryKey: ['share-activity-metrics', activityStart?.toISOString(), activityEnd?.toISOString()],
    staleTime: 5 * 60 * 1000,
  })
  // The route map is rendered from actual GPS points, so gate its toggle on real
  // location data — not a distance/speed proxy (a treadmill run has those but no
  // GPS, and would otherwise attach a route.png that 404s).
  const locationsQuery = useQuery({
    enabled: activityStart != null && activityEnd != null,
    queryFn: () => fetchRawLocations(activityStart ?? new Date(), activityEnd ?? new Date()),
    queryKey: ['share-activity-locations', activityStart?.toISOString(), activityEnd?.toISOString()],
    staleTime: 5 * 60 * 1000,
  })
  const hasGps = (locationsQuery.data?.length ?? 0) > 0

  const present = availabilityQuery.data?.buckets
    ? new Set(availabilityQuery.data.buckets.flatMap((b) => Object.keys(b.metrics)))
    : undefined
  return {
    // The chart renders heart rate (a time-series metric, so presence is exact).
    // `keepChart`/`keepMap` keep an already-attached image toggleable when editing.
    canChart: present ? present.has('heart_rate') || keepChart : true,
    canMap: hasGps || keepMap,
    seriesOptions: present
      ? SERIES_METRICS.filter((m) => present.has(m.key) || keepSeries.includes(m.key))
      : SERIES_METRICS,
    summaryOptions: present
      ? SUMMARY_METRICS.filter(
          (m) => m.source === undefined || present.has(m.source) || keepSummary.includes(m.key),
        )
      : SUMMARY_METRICS,
  }
}

// eslint-disable-next-line complexity -- composite share/edit form (metrics, series, images, visibility)
export function ShareActivityDialog({
  activityId,
  activityTitle,
  activityStart,
  activityEnd,
  chartMetrics,
  defaultMessage,
  post,
  onClose,
  onShared,
}: Props) {
  const queryClient = useQueryClient()
  // Create mode mirrors the chart's shown metrics; edit mode uses the post's saved selection.
  const defaults = defaultsFromChart(chartMetrics)
  const mirroredFromChart = !post && (chartMetrics?.length ?? 0) > 0
  const [summary, setSummary] = useState<Set<string>>(
    () => new Set(post ? post.included_metrics : defaults.summary),
  )
  // Preselect from the post's shared series (edit) or the charted metrics (create),
  // intersected with keys this dialog can represent — keeps the state typed as
  // `Set<MetricType>` without a cast. `initialSeriesSelection` folds a legacy
  // chart-image post into the heart-rate series (one control governs both).
  const [series, setSeries] = useState<Set<MetricType>>(
    () => new Set(post ? initialSeriesSelection(post) : defaults.series),
  )
  const [visibility, setVisibility] = useState<FeedVisibility>(post?.visibility ?? 'public')
  const [includeMap, setIncludeMap] = useState(post?.include_map ?? false)
  // Edit mode shows the stored message; create mode prefills (see `defaultMessage`).
  const [message, setMessage] = useState(post ? (post.message ?? '') : (defaultMessage ?? ''))
  const { summaryOptions, seriesOptions, canChart, canMap } = useShareableMetricOptions(
    activityStart,
    activityEnd,
    post?.included_metrics,
    // Offer the heart-rate series on an edit whenever the post shares it in either
    // format, so the unified control is always toggleable (never stuck checked).
    post ? initialSeriesSelection(post) : undefined,
    post?.include_chart,
    post?.include_map,
  )
  // The series fieldset also renders for activities with only non-HR series (e.g.
  // speed/power, no heart rate); only mention the chart image when heart rate is
  // actually offered as a control here.
  const offersHeartRate = seriesOptions.some((m) => m.key === 'heart_rate')

  const currentBody = () =>
    buildShareBody({
      canChart,
      canMap,
      includeMap,
      message,
      series,
      seriesOptions,
      summary,
      summaryOptions,
      visibility,
    })

  // Live preview (#902): the server resolves the EXACT federated content for
  // the current selection (same code path as delivery), debounced so typing in
  // the message doesn't fire a request per keystroke. Keyed on the serialised
  // body — identical selections hit the react-query cache.
  const [debouncedKey, setDebouncedKey] = useState('')
  const bodyKey = JSON.stringify(currentBody())
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKey(bodyKey), 400)
    return () => clearTimeout(timer)
  }, [bodyKey])
  const previewQuery = useQuery({
    enabled: debouncedKey !== '',
    queryFn: () => previewShare(activityId, JSON.parse(debouncedKey)),
    queryKey: ['share-preview', activityId, debouncedKey],
    staleTime: 60_000,
  })
  const previewContent = previewQuery.data?.content

  const mutation = useMutation({
    mutationFn: () => {
      const body = currentBody()
      return post ? updateFeedPost(post.id, body) : shareActivity(activityId, body)
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['feed'] })
      onShared?.(result)
      onClose()
    },
  })

  const previewImages = [
    ...(canMap && includeMap ? ['the route-map image'] : []),
    ...(canChart && series.has('heart_rate') ? ['the heart-rate chart image'] : []),
  ]

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
          <legend>Message</legend>
          <p class="share-dialog-note">
            {!post && defaultMessage
              ? 'Prefilled from the activity’s description — edit freely; empty shares no text.'
              : 'Optional text shown at the top of the post.'}
          </p>
          <textarea
            class="share-dialog-message"
            rows={3}
            maxLength={feedPostMessageMaxLength}
            value={message}
            onInput={(e) => setMessage((e.target as HTMLTextAreaElement).value)}
            placeholder="Say something about this activity…"
          />
        </fieldset>

        <fieldset class="share-dialog-group">
          <legend>Summary metrics</legend>
          <div class="share-dialog-options">
            {summaryOptions.map(({ key, label }) => (
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

        {seriesOptions.length > 0 && (
          <fieldset class="share-dialog-group">
            <legend>Share full time-series</legend>
            <p class="share-dialog-note">
              {mirroredFromChart
                ? 'Higher resolution — more revealing than a summary. Pre-checked to match the activity chart; uncheck any you would rather not share.'
                : 'Higher resolution — more revealing than a summary. Off by default.'}
              {offersHeartRate && ' Heart rate is also shared as a chart image.'}
            </p>
            <div class="share-dialog-options">
              {seriesOptions.map(({ key, label }) => (
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
        )}

        {canMap && (
          <fieldset class="share-dialog-group">
            <legend>Images</legend>
            <div class="share-dialog-options">
              <label class="share-dialog-checkbox">
                <input
                  type="checkbox"
                  checked={includeMap}
                  onChange={(e) => setIncludeMap((e.target as HTMLInputElement).checked)}
                />
                Route map
              </label>
            </div>
          </fieldset>
        )}

        <VisibilitySelector
          name="feed-visibility"
          options={FEED_VISIBILITY_OPTIONS}
          value={visibility}
          onChange={setVisibility}
        />

        <fieldset class="share-dialog-group">
          <legend>Preview</legend>
          <p class="share-dialog-note">
            Exactly what a follower on Mastodon sees
            {previewImages.length > 0 ? ` — plus ${previewImages.join(' and ')}` : ''}.
          </p>
          {previewContent ? (
            // Server-built, HTML-escaped content of the user's OWN data — the
            // same trusted string the owner feed card renders (#902).
            <div class="share-dialog-preview" dangerouslySetInnerHTML={{ __html: previewContent }} />
          ) : (
            <p class="share-dialog-note">{previewQuery.isError ? 'Preview unavailable.' : 'Loading…'}</p>
          )}
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
            disabled={mutation.isPending || !summaryOptions.some((m) => summary.has(m.key))}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? (post ? 'Saving…' : 'Sharing…') : post ? 'Save changes' : 'Share'}
          </button>
        </div>
      </div>
    </div>
  )
}
