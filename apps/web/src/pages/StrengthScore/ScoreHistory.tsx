import type { StrengthScoreGroup } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'preact/hooks'

import { TrendLineChart } from '../../components/charts/TrendLineChart'
import { fetchStrengthScoreHistory } from '../../state/api'
import { CHART_PRIMARY } from '../../theme'
import {
  groupsWithHistory,
  type ScoreSeriesKey,
  scoreSeries,
  STRENGTH_SCORE_PERIODS,
  strengthScorePeriod,
} from './strengthScoreView'

const FIVE_MIN = 5 * 60 * 1000

export const useStrengthScoreHistory = (name: string, field: string, days: number) => {
  const period = useMemo(() => strengthScorePeriod(days, new Date()), [days])
  return useQuery({
    queryFn: () => fetchStrengthScoreHistory(name, { field, ...period }),
    queryKey: ['strength-score-history', name, field, period.start, period.end, period.step_days],
    staleTime: FIVE_MIN,
  })
}

const Chart = ({ data }: { data: { date: string; value: number }[] }) =>
  data.length < 2 ? (
    <p class="activity-type-item-empty">Not enough history yet.</p>
  ) : (
    <>
      <TrendLineChart data={data} color={CHART_PRIMARY} height={220} />
      <p class="activity-type-item-caption">Each point looks back over the 90 days before it.</p>
    </>
  )

export const ScoreHistory = ({
  field,
  groupNames,
  name,
}: {
  field: string
  groupNames: Partial<Record<StrengthScoreGroup, string>>
  name: string
}) => {
  const [days, setDays] = useState(STRENGTH_SCORE_PERIODS[0].value)
  const [series, setSeries] = useState<ScoreSeriesKey>('overall')
  const query = useStrengthScoreHistory(name, field, days)
  const groups = groupsWithHistory(query.data)
  const shown = series === 'overall' || groups.includes(series) ? series : 'overall'
  const data = useMemo(() => scoreSeries(query.data, shown), [query.data, shown])

  return (
    <section class="activity-type-item-section">
      <div class="activity-type-item-section-header strength-score-history-header">
        <h2>Score over time</h2>
        <select
          aria-label="Series"
          value={shown}
          onChange={(e) => setSeries((e.target as HTMLSelectElement).value as ScoreSeriesKey)}
        >
          <option value="overall">Overall</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              {groupNames[g] ?? g}
            </option>
          ))}
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
      </div>
      {query.isLoading && <p class="loading">Loading...</p>}
      {query.isError && <p class="error">Failed to load the strength score</p>}
      {query.isSuccess && <Chart data={data} />}
    </section>
  )
}
