import { Fragment } from 'preact'

import type { HrvStatsWithDelta, WindowEffect } from '../../state/api'

import { changeClass, changeTitle, columnTitles, formatDelta, getDeltaClass, roundTo } from './effects'

export interface ContextTableRow {
  key: string
  name: string
  extra?: string
  stats: HrvStatsWithDelta
  selected: boolean
  onSelect: () => void
}

interface MetricColumns {
  label: string
  mean: (s: HrvStatsWithDelta) => number | null
  delta: (s: HrvStatsWithDelta) => number | null
  effect: (s: HrvStatsWithDelta) => WindowEffect
  decimals: number
  inverted: boolean
}

const METRICS: MetricColumns[] = [
  {
    decimals: 1,
    delta: (s) => s.hrv_delta_from_baseline,
    effect: (s) => s.hrv_effect,
    inverted: false,
    label: 'HRV',
    mean: (s) => s.mean_hrv,
  },
  {
    decimals: 0,
    delta: (s) => s.hr_delta_from_baseline,
    effect: (s) => s.hr_effect,
    inverted: true,
    label: 'Heart rate',
    mean: (s) => s.mean_hr,
  },
  {
    decimals: 0,
    delta: (s) => s.stress_delta_from_baseline,
    effect: (s) => s.stress_effect,
    inverted: true,
    label: 'Stress',
    mean: (s) => s.mean_stress,
  },
]

function MetricCells({ metric, stats }: { metric: MetricColumns; stats: HrvStatsWithDelta }) {
  const mean = metric.mean(stats)
  const delta = roundTo(metric.delta(stats), metric.decimals)
  const effect = metric.effect(stats)
  return (
    <>
      <td class="value-cell group-start">{mean?.toFixed(metric.decimals) ?? '--'}</td>
      <td class={`delta-cell ${getDeltaClass(delta, metric.inverted)}`}>
        {formatDelta(delta, metric.decimals)}
      </td>
      <td
        class={`delta-cell change-cell ${changeClass(effect, metric.inverted)}`}
        title={changeTitle(effect)}
      >
        {formatDelta(effect.change, 1)}
      </td>
    </>
  )
}

export function ContextTable({
  title,
  nameHeader,
  rows,
  windowMinutes,
}: {
  title: string
  nameHeader: string
  rows: ContextTableRow[]
  windowMinutes: number
}) {
  const titles = columnTitles(windowMinutes)
  const metrics = METRICS.filter((m) =>
    rows.some((row) => m.mean(row.stats) !== null || m.effect(row.stats).change !== null),
  )
  return (
    <section class="table-section">
      <h2>{title}</h2>
      <div class="table-container">
        <table class="correlations-table context-table">
          <thead>
            <tr>
              <th rowSpan={2}>{nameHeader}</th>
              {metrics.map((m) => (
                <th key={m.label} colSpan={3} class="group-header group-start">
                  {m.label}
                </th>
              ))}
              <th rowSpan={2}>Time</th>
            </tr>
            <tr>
              {metrics.map((m) => (
                <Fragment key={m.label}>
                  <th class="sub-header group-start" title={titles.during}>
                    During
                  </th>
                  <th class="sub-header" title={titles.vs_avg}>
                    vs avg
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
              <tr key={row.key} class={row.selected ? 'selected' : ''} onClick={row.onSelect}>
                <td class="name-cell">
                  <span class="name">{row.name}</span>
                  {row.extra && <span class="extra">{row.extra}</span>}
                </td>
                {metrics.map((m) => (
                  <MetricCells key={m.label} metric={m} stats={row.stats} />
                ))}
                <td class="samples-cell">{row.stats.sample_minutes} min</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
