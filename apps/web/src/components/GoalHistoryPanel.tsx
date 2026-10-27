import type { GoalHistoryResponse } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'preact/hooks'

import { fetchGoalHistory, type Goal } from '../state/api'
import { GoalHistoryChart, type GoalHistoryChartMode } from './charts/GoalHistoryChart'
import {
  type GoalHistoryRange,
  goalHistoryRangeLabels,
  goalHistoryRanges,
  rangeToQuery,
  summaryText,
} from './goal-history-range'
import { goalValueFormat } from './goalFormat'

interface GoalHistoryPanelProps {
  goal: Goal
  range: GoalHistoryRange
  onRangeChange: (range: GoalHistoryRange) => void
}

const chartMode = (data: GoalHistoryResponse): GoalHistoryChartMode => {
  if (data.bucket === 'month') return 'months'
  return data.goal.goal_type === 'trend' ? 'line' : 'bars'
}

export function GoalHistoryPanel({ goal, range, onRangeChange }: GoalHistoryPanelProps) {
  const { data, isError, isLoading } = useQuery({
    queryFn: () => fetchGoalHistory(goal.id, rangeToQuery(range)),
    queryKey: ['goalHistory', goal.id, range],
    staleTime: 5 * 60_000,
  })

  const unit = data?.unit
  const format = useMemo(() => goalValueFormat(goal, unit), [goal, unit])

  const today = data?.days?.find((d) => d.partial)

  return (
    <div class="goal-history-panel">
      <div class="range-toggle" role="group" aria-label="History range">
        {goalHistoryRanges.map((r) => (
          <button key={r} type="button" aria-pressed={r === range} onClick={() => onRangeChange(r)}>
            {goalHistoryRangeLabels[r]}
          </button>
        ))}
      </div>

      {isLoading && <p class="goal-history-status">Loading history…</p>}
      {isError && <p class="goal-history-status error">Could not load history.</p>}

      {data && (
        <>
          <p class="goal-history-summary">{summaryText(data.summary, data.bucket, today?.status)}</p>
          <GoalHistoryChart
            days={data.days}
            months={data.months}
            min={data.min}
            max={data.max}
            mode={chartMode(data)}
            formatValue={format}
          />
          <p class="goal-history-footnote">
            {data.bucket === 'month'
              ? 'Bars show the days on target each month, out of the days counted. '
              : 'Each day shows the goal value at the end of that day (UTC). '}
            Today is not counted yet. Every day is judged against the current target.
          </p>
        </>
      )}
    </div>
  )
}
