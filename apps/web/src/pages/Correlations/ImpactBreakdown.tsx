import { type ActivityImpactData, IMPACT_FIELD_DIMENSION_PREFIX } from '@aurboda/api-spec'

import type { ImpactExtra, ImpactMetric } from '../../components/charts/impactMetrics'

import { BreakdownTable } from './BreakdownTable'
import { GroupImpactChart } from './GroupImpactChart'
import {
  breakdownMetricOptions,
  chartableGroups,
  MAX_CHART_GROUPS,
  MIN_CHART_OCCURRENCES,
  resolveBreakdownMetric,
} from './slicing'

const FIXED_UNITS: Record<string, string> = { hr: 'bpm', hrv: 'ms' }

const unitOf = (key: string, extras: readonly (ImpactExtra & { unit?: string | null })[]): string | null => {
  const unit = FIXED_UNITS[key] ?? extras.find((e) => e.metric === key)?.unit ?? null
  return unit === 'score' ? null : unit
}

/** The selected row's impact per group of the chosen dimension: one metric charted, every shown metric tabled. */
export function ImpactBreakdown({
  data,
  metrics,
  extras,
  breakdownMetric,
  onBreakdownMetricChange,
}: {
  data: ActivityImpactData
  metrics: readonly ImpactMetric[]
  extras: readonly (ImpactExtra & { unit?: string | null })[]
  breakdownMetric: string
  onBreakdownMetricChange: (metric: string) => void
}) {
  const breakdown = data.breakdown
  if (!breakdown) return null
  const options = breakdownMetricOptions(metrics, extras)
  const metricKey = resolveBreakdownMetric(breakdownMetric, options)
  const metricLabel = options.find((o) => o.key === metricKey)?.label ?? metricKey
  const withEnough = breakdown.groups.filter((g) => g.occurrences >= MIN_CHART_OCCURRENCES)
  const drawn = chartableGroups(breakdown.groups)
  return (
    <div class="impact-breakdown">
      <div class="breakdown-heading">
        <h3>By {breakdown.label.toLowerCase()}</h3>
        {options.length > 1 && (
          <label class="breakdown-metric">
            Chart{' '}
            <select
              class="period-select"
              value={metricKey}
              onChange={(e) => onBreakdownMetricChange((e.target as HTMLSelectElement).value)}
            >
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {metricKey && (
        <GroupImpactChart
          overall={data}
          groups={drawn}
          metricKey={metricKey}
          metricLabel={metricLabel}
          unit={unitOf(metricKey, extras)}
        />
      )}
      <BreakdownTable overall={data} groups={breakdown.groups} metrics={options} />
      {withEnough.length < breakdown.groups.length && (
        <p class="breakdown-note">
          Groups with fewer than {MIN_CHART_OCCURRENCES} sessions are in the table but not drawn.
        </p>
      )}
      {withEnough.length > MAX_CHART_GROUPS && (
        <p class="breakdown-note">The chart shows the {MAX_CHART_GROUPS} largest groups.</p>
      )}
      {breakdown.omitted_groups > 0 && (
        <p class="breakdown-note">
          {breakdown.omitted_groups} more {breakdown.omitted_groups === 1 ? 'value' : 'values'} with fewer
          sessions {breakdown.omitted_groups === 1 ? 'is' : 'are'} left out.
        </p>
      )}
      <p class="breakdown-note">
        With several groups, one can look clear by chance. Read small groups as hints.
      </p>
      {breakdown.dimension.startsWith(IMPACT_FIELD_DIMENSION_PREFIX) && (
        <p class="breakdown-note">A session with several values counts under each.</p>
      )}
    </div>
  )
}
