import { comparePeriodKeys, periodLabel, shiftPeriodKey } from '@aurboda/api-spec'

import type { PeriodDashboardState } from './usePeriodDashboard'

import './PeriodSwitcher.css'

interface PeriodSwitcherProps {
  /** The shown period key (2026-10, 2026-W44, 2026). */
  value: string
  /** The latest finished period; the switcher does not step past it. */
  latest: string
  /** The earliest period it may step back to; unbounded when absent. */
  earliest?: string
  onChange: (key: string) => void
}

/**
 * The keys the previous and next buttons step to; `next` is null at the latest finished period and
 * `previous` at `earliest`.
 */
export const periodSteps = (
  value: string,
  latest: string,
  earliest?: string,
): { next: string | null; previous: string | null } => ({
  next: comparePeriodKeys(value, latest) >= 0 ? null : shiftPeriodKey(value, 1),
  previous:
    earliest !== undefined && comparePeriodKeys(value, earliest) <= 0 ? null : shiftPeriodKey(value, -1),
})

export function PeriodSwitcher({ value, latest, earliest, onChange }: PeriodSwitcherProps) {
  const { next, previous } = periodSteps(value, latest, earliest)
  return (
    <div class="period-switcher" role="group" aria-label="Period">
      <button
        type="button"
        class="period-switcher-btn"
        disabled={previous === null}
        onClick={() => previous && onChange(previous)}
        aria-label="Previous period"
        title="Previous period"
      >
        ‹
      </button>
      <span class="period-switcher-label">{periodLabel(value)}</span>
      <button
        type="button"
        class="period-switcher-btn"
        disabled={next === null}
        onClick={() => next && onChange(next)}
        aria-label="Next period"
        title="Next period"
      >
        ›
      </button>
    </div>
  )
}

/** The switcher of a period dashboard, or what stands in for it while the period is unknown. */
export function PeriodDashboardBar({ state }: { state: PeriodDashboardState }) {
  if (state.isError && state.period === null) return <div class="error">Could not load this period.</div>
  if (state.period === null || state.latest === null) return <div class="loading">Loading period…</div>
  return <PeriodSwitcher value={state.period} latest={state.latest} onChange={state.select} />
}
