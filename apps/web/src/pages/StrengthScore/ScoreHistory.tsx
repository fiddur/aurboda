import type { StrengthScoreGroup } from '@aurboda/api-spec'

import { useMemo, useState } from 'preact/hooks'

import { ChartMenu } from '../../components/charts/ChartMenu'
import { type LineSeriesData, TrendLineChart } from '../../components/charts/TrendLineChart'
import { CHART_PRIMARY } from '../../theme'
import { newWidgetId } from '../../utils/widget-id'
import { useStrengthScoreHistory } from './queries'
import { scoreChartMenu } from './scoreChartMenu'
import {
  ALL_GROUPS,
  allGroupsSeries,
  groupsWithHistory,
  type ScoreSeriesChoice,
  scoreSeries,
  STRENGTH_SCORE_PERIODS,
} from './strengthScoreView'
import '../../components/charts/breakdown.css'

const CAPTION = 'Each point looks back over the 90 days before it.'

const Chart = ({ data }: { data: { date: string; value: number }[] }) =>
  data.length < 2 ? (
    <p class="activity-type-item-empty">Not enough history yet.</p>
  ) : (
    <>
      <TrendLineChart data={data} color={CHART_PRIMARY} height={220} />
      <p class="activity-type-item-caption">{CAPTION}</p>
    </>
  )

const AllGroupsChart = ({ series }: { series: LineSeriesData[] }) => (
  <>
    <TrendLineChart data={[]} color={CHART_PRIMARY} height={220} multiSeries={series} linesOnly />
    <div class="breakdown-legend">
      {series.map((s) => (
        <span key={s.name} class="breakdown-legend-item">
          <span class="breakdown-legend-dot" style={{ background: s.color }} />
          {s.name}
        </span>
      ))}
    </div>
    <p class="activity-type-item-caption">{CAPTION}</p>
  </>
)

const ScoreMenu = ({ days, metric }: { days: number; metric: string }) => {
  const menu = scoreChartMenu(metric, days)
  return (
    <ChartMenu
      exploreHref={menu.exploreHref}
      widget={(title) => menu.widget(title, newWidgetId())}
      goalHref={menu.goalHref}
      extraWidgets={[
        { label: 'Add sparkline card', widget: (title) => menu.sparkline(title, newWidgetId()) },
      ]}
    />
  )
}

export const ScoreHistory = ({
  field,
  groupNames,
  metricOf,
  name,
}: {
  field: string
  groupNames: Partial<Record<StrengthScoreGroup, string>>
  metricOf?: (group?: StrengthScoreGroup) => string
  name: string
}) => {
  const [days, setDays] = useState(STRENGTH_SCORE_PERIODS[0].value)
  const [series, setSeries] = useState<ScoreSeriesChoice>('overall')
  const query = useStrengthScoreHistory(name, field, days)
  const groups = groupsWithHistory(query.data)
  const allAvailable = groups.length >= 2
  const shown: ScoreSeriesChoice =
    series === 'overall' || (series === ALL_GROUPS ? allAvailable : groups.includes(series))
      ? series
      : 'overall'
  const data = useMemo(
    () => (shown === ALL_GROUPS ? [] : scoreSeries(query.data, shown)),
    [query.data, shown],
  )
  const all = useMemo(
    () => (shown === ALL_GROUPS ? allGroupsSeries(query.data, groupNames) : []),
    [query.data, shown, groupNames],
  )

  return (
    <section class="activity-type-item-section">
      <div class="activity-type-item-section-header strength-score-history-header">
        <h2>Score over time</h2>
        <div class="strength-score-history-controls">
          <select
            aria-label="Series"
            value={shown}
            onChange={(e) => setSeries((e.target as HTMLSelectElement).value as ScoreSeriesChoice)}
          >
            <option value="overall">Overall</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {groupNames[g] ?? g}
              </option>
            ))}
            {allAvailable && <option value={ALL_GROUPS}>All muscle groups</option>}
          </select>
          <select
            aria-label="Period"
            value={days}
            onChange={(e) => setDays(Number((e.target as HTMLSelectElement).value))}
          >
            {STRENGTH_SCORE_PERIODS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {metricOf && shown !== ALL_GROUPS && (
            <ScoreMenu days={days} metric={metricOf(shown === 'overall' ? undefined : shown)} />
          )}
        </div>
      </div>
      {query.isLoading && <p class="loading">Loading...</p>}
      {query.isError && <p class="error">Failed to load the strength score</p>}
      {query.isSuccess && (shown === ALL_GROUPS ? <AllGroupsChart series={all} /> : <Chart data={data} />)}
    </section>
  )
}
