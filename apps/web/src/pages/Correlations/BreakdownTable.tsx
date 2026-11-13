import type { ActivityImpactData, ImpactGroup } from '@aurboda/api-spec'

import { Fragment } from 'preact'

import { changeClass, changeTitle, columnTitles, formatDelta } from './effects'
import { formatAvgDuration } from './occurrences'
import {
  type BreakdownMetricOption,
  type ImpactSlice,
  metricAccessors,
  MIN_CHART_OCCURRENCES,
} from './slicing'

interface BreakdownRow {
  key: string
  label: string
  occurrences: number
  avgDurationMin: number | null | undefined
  slice: ImpactSlice
  className: string
  title?: string
}

const describeRow = (occurrences: number, avgDurationMin: number | null | undefined): string => {
  const count = `${occurrences} ${occurrences === 1 ? 'session' : 'sessions'}`
  const avg = formatAvgDuration(avgDurationMin)
  return avg ? `${count} · ${avg}` : count
}

const toRows = (overall: ActivityImpactData, groups: readonly ImpactGroup[]): BreakdownRow[] => [
  {
    avgDurationMin: overall.avg_duration_min,
    className: 'overall',
    key: '',
    label: 'All sessions',
    occurrences: overall.occurrences,
    slice: overall,
  },
  ...groups.map((g) => {
    const sparse = g.occurrences < MIN_CHART_OCCURRENCES
    return {
      avgDurationMin: g.avg_duration_min,
      className: sparse ? 'sparse' : '',
      key: g.key,
      label: g.label,
      occurrences: g.occurrences,
      slice: g,
      ...(sparse && { title: 'Too few sessions to tell' }),
    }
  }),
]

/** One row for every session and one per group, with During and Change for each shown metric. */
export function BreakdownTable({
  overall,
  groups,
  metrics: shown,
}: {
  overall: ActivityImpactData
  groups: readonly ImpactGroup[]
  metrics: readonly BreakdownMetricOption[]
}) {
  const titles = columnTitles(overall.window_minutes)
  const rows = toRows(overall, groups)
  const metrics = shown
    .map((m) => ({ ...m, ...metricAccessors(m.key) }))
    .filter((m) => rows.some((row) => m.during(row.slice) !== null || m.effect(row.slice).change !== null))
  return (
    <div class="table-container">
      <table class="correlations-table context-table breakdown-table">
        <thead>
          <tr>
            <th rowSpan={2}>Group</th>
            {metrics.map((m) => (
              <th key={m.key} colSpan={2} class="group-header group-start">
                {m.label}
              </th>
            ))}
          </tr>
          <tr>
            {metrics.map((m) => (
              <Fragment key={m.key}>
                <th class="sub-header group-start" title={titles.during}>
                  During
                </th>
                <th class="sub-header" title={titles.change}>
                  Change
                </th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} class={row.className} title={row.title}>
              <td class="name-cell">
                <span class="name">{row.label}</span>
                <span class="extra">{describeRow(row.occurrences, row.avgDurationMin)}</span>
              </td>
              {metrics.map((m) => {
                const during = m.during(row.slice)
                const effect = m.effect(row.slice)
                return (
                  <Fragment key={m.key}>
                    <td class="value-cell group-start">{during?.toFixed(m.decimals) ?? '--'}</td>
                    <td
                      class={`delta-cell change-cell ${changeClass(effect, m.direction)}`}
                      title={changeTitle(effect)}
                    >
                      {formatDelta(effect.change, 1)}
                    </td>
                  </Fragment>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
