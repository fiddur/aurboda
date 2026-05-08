import { signal } from '@preact/signals'
import { addDays, differenceInCalendarDays, endOfDay, format, formatISO, startOfDay, subDays } from 'date-fns'
import { useCallback, useMemo } from 'preact/hooks'

import { collapseDepthForPixelsPerHour, computePixelsPerHour } from './collapseTier'
import { getDefaultViewEnd, getDefaultViewStart, parseViewHash } from './viewHash'

// ── Signals (module-level, persist across SPA navigations) ────────────────────

const fromDate = signal(formatISO(subDays(new Date(), 1), { representation: 'date' }))
const toDate = signal(formatISO(new Date(), { representation: 'date' }))
const viewStart = signal<Date | null>(null)
const viewEnd = signal<Date | null>(null)

// Initialise signals from hash on page load
const _initialHash = parseViewHash()
if (_initialHash.from) {
  viewStart.value = _initialHash.from
  viewEnd.value = _initialHash.to
  const fetchFrom = _initialHash.from
  const fetchTo = _initialHash.to ?? _initialHash.from
  fromDate.value = formatISO(subDays(fetchFrom, 1), { representation: 'date' })
  const todayStr = formatISO(new Date(), { representation: 'date' })
  const expandedTo = formatISO(addDays(fetchTo, 1), { representation: 'date' })
  toDate.value = expandedTo > todayStr ? todayStr : expandedTo
}

export { _initialHash }

export interface TimelineNavigation {
  effectiveViewStart: Date
  effectiveViewEnd: Date
  fetchStart: Date
  fetchEnd: Date
  fromDate: typeof fromDate
  toDate: typeof toDate
  viewStart: typeof viewStart
  viewEnd: typeof viewEnd
  handleZoom: (start: Date, end: Date) => void
  handleJumpDays: (days: number) => void
  handleResetToToday: () => void
  viewLabel: string
  bucketSize: string
  barBucketSize: '1h' | '1d' | '1w'
  /** Gap (ms) below which adjacent same-key activities merge in the timeline. */
  mergeGapMs: number
  /**
   * How many parent_type hops to walk during hierarchy collapse. 0 = no
   * walk (max-zoom). 1 = one hop (moderate zoom-out).
   * Number.POSITIVE_INFINITY = walk to root (deep zoom-out).
   */
  collapseDepth: number
}

export interface TimelineNavigationOptions {
  /**
   * Chart pixel dimension along the time axis — chartHeight in vertical
   * orientation, chartWidth in horizontal. The caller measures the container
   * and subtracts margins; we just need a single resolved number here.
   * Pass 0 (or omit) before mount / before first measurement; collapseDepth
   * will fall back to 0 (no walk) until a real value arrives.
   */
  timeAxisPixels?: number
}

export const useTimelineNavigation = (options: TimelineNavigationOptions = {}): TimelineNavigation => {
  const { timeAxisPixels = 0 } = options
  const effectiveViewStart = viewStart.value ?? getDefaultViewStart()
  const effectiveViewEnd = viewEnd.value ?? getDefaultViewEnd()

  const fetchStart = startOfDay(new Date(fromDate.value))
  const fetchEnd = endOfDay(new Date(toDate.value))

  const bucketSize = useMemo(() => {
    const days = differenceInCalendarDays(effectiveViewEnd, effectiveViewStart)
    if (days > 500) return '1w'
    if (days > 21) return '1d'
    if (days > 5) return '1h'
    if (days > 1) return '15m'
    return '5m'
  }, [effectiveViewStart, effectiveViewEnd])

  const barBucketSize = useMemo((): '1h' | '1d' | '1w' => {
    const days = differenceInCalendarDays(effectiveViewEnd, effectiveViewStart)
    if (days > 50) return '1w'
    if (days > 2) return '1d'
    return '1h'
  }, [effectiveViewStart, effectiveViewEnd])

  // Zoom-graded merge gap: as the user zooms out we bridge larger gaps so that
  // a long string of small same-type activities reads as one bar. At the most
  // zoomed-in tier we still merge the very small gaps (10 min) so back-to-back
  // screentime spans don't show as a comb of identical slivers, but we keep the
  // gap small enough that genuinely separate sessions stay separate.
  const mergeGapMs = useMemo(() => {
    const days = differenceInCalendarDays(effectiveViewEnd, effectiveViewStart)
    if (days > 50) return 4 * 60 * 60 * 1000
    if (days > 2) return 60 * 60 * 1000
    return 10 * 60 * 1000
  }, [effectiveViewStart, effectiveViewEnd])

  // Multi-tier collapse depth (#656/#658): at max zoom (high pixels-per-hour)
  // the user wants to see (and click to edit) sibling sub-types like
  // warmup_run vs strength_training distinctly. Moderate zoom collapses one
  // hop (warmup_run → exercise); deep zoom walks to root so a multi-week view
  // reads as fewer, broader bars.
  //
  // #658 switched from absolute days to pixels-per-hour so the threshold
  // adapts to container width: a 7-day view on a 360px mobile collapses
  // as if it were ~14 days at desktop width. `timeAxisPixels` ≤ 0 (pre-mount,
  // pre-measure) yields depth 0, which keeps the existing data visible
  // until the first measurement.
  const collapseDepth = useMemo(
    () =>
      collapseDepthForPixelsPerHour(
        computePixelsPerHour(timeAxisPixels, effectiveViewStart, effectiveViewEnd),
      ),
    [timeAxisPixels, effectiveViewStart, effectiveViewEnd],
  )

  const handleZoom = useCallback((zoomStart: Date, zoomEnd: Date) => {
    viewStart.value = zoomStart
    viewEnd.value = zoomEnd

    const currentFetchStart = startOfDay(new Date(fromDate.value))
    const currentFetchEnd = endOfDay(new Date(toDate.value))
    const todayStr = formatISO(new Date(), { representation: 'date' })

    let needsExpand = false
    let newFrom = fromDate.value
    let newTo = toDate.value

    if (zoomStart < currentFetchStart) {
      newFrom = formatISO(subDays(zoomStart, 3), { representation: 'date' })
      needsExpand = true
    }
    if (zoomEnd > currentFetchEnd) {
      const expanded = formatISO(addDays(zoomEnd, 3), { representation: 'date' })
      newTo = expanded > todayStr ? todayStr : expanded
      needsExpand = true
    }

    if (needsExpand) {
      fromDate.value = newFrom
      toDate.value = newTo
    }
  }, [])

  const handleJumpDays = useCallback(
    (days: number) => {
      const currentStart = viewStart.value ?? getDefaultViewStart()
      const currentEnd = viewEnd.value ?? getDefaultViewEnd()
      const newStart = addDays(currentStart, days)
      const newEnd = addDays(currentEnd, days)
      const todayEnd = endOfDay(new Date())
      if (newEnd > todayEnd) return
      handleZoom(newStart, newEnd)
    },
    [handleZoom],
  )

  const handleResetToToday = useCallback(() => {
    viewStart.value = null
    viewEnd.value = null
    fromDate.value = formatISO(subDays(new Date(), 1), { representation: 'date' })
    toDate.value = formatISO(new Date(), { representation: 'date' })
  }, [])

  const viewLabel =
    format(effectiveViewStart, 'MMM d') === format(effectiveViewEnd, 'MMM d')
      ? format(effectiveViewStart, 'MMM d, yyyy')
      : `${format(effectiveViewStart, 'MMM d')} – ${format(effectiveViewEnd, 'MMM d, yyyy')}`

  return {
    barBucketSize,
    bucketSize,
    collapseDepth,
    effectiveViewEnd,
    effectiveViewStart,
    fetchEnd,
    fetchStart,
    fromDate,
    handleJumpDays,
    handleResetToToday,
    handleZoom,
    mergeGapMs,
    toDate,
    viewEnd,
    viewLabel,
    viewStart,
  }
}
