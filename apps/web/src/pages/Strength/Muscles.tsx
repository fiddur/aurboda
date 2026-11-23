import type { StrengthScore, StrengthScoreHistory } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'preact/hooks'

import { useMuscleRecovery } from '../../components/muscleRecovery/useMuscleRecovery'
import { SparklineChart } from '../../components/SparklineChart'
import { fetchChartData, fetchMuscleGroups } from '../../state/api'
import { CHART_PRIMARY } from '../../theme'
import { formatSetCount } from '../../utils/measures'
import { unmappedSectionId } from '../ActivityTypeMeta/UnmappedItemValuesSection'
import { MissingNotice } from '../StrengthScore/index'
import { useStrengthScore, useStrengthScoreHistory } from '../StrengthScore/queries'
import { pointsLabel, scoreChange, scoreSeries } from '../StrengthScore/strengthScoreView'
import { SETS_PATH, STRENGTH_TYPE } from './constants'
import { MuscleRow } from './MuscleRow'
import {
  changeInDaysLabel,
  extremesLine,
  MUSCLE_SORTS,
  muscleRows,
  muscleSections,
  type MuscleRow as Row,
  type MuscleSort,
  noStrengthSessions,
  SCORE_CHANGE_DAYS,
  SET_WINDOWS,
  setsPeriod,
  setWindows,
  statusLine,
  unmatchedSets,
} from './musclesModel'
import { PlannedToday } from './PlannedWorkouts'
import { useOpenStrengthPlans, useUnfinishedSession } from './queries'
import { StrengthHeader } from './StrengthHeader'
import '../../components/muscleRecovery/muscleRecovery.css'
import '../ActivityTypeItem/style.css'
import '../StrengthScore/style.css'
import './style.css'

const FIVE_MIN = 5 * 60 * 1000
const HISTORY_DAYS = 365

const CAPTION =
  'Recovery comes from the sets of the last 10 days. Sets count each exercise by how much it works the muscle. The score compares your best lifts of the last 90 days with a reference for your bodyweight; 100 is a solid recreational lifter.'

const ScoreCard = ({ history, score }: { history?: StrengthScoreHistory | null; score: StrengthScore }) => {
  if (score.missing.length > 0) return <MissingNotice missing={score.missing} />
  if (score.score === null) {
    return (
      <a class="strength-card strength-muscles-score" href="/strength/progress">
        <span class="strength-muscles-score-label">Strength score</span>
        <span>No strength score yet</span>
      </a>
    )
  }
  const change = scoreChange(history, SCORE_CHANGE_DAYS)
  const series = scoreSeries(history, 'overall').map((p): [Date, number] => [new Date(p.date), p.value])
  const extremes = extremesLine(score)
  return (
    <a class="strength-card strength-muscles-score" href="/strength/progress">
      <span class="strength-muscles-score-label">Strength score</span>
      <span class="strength-muscles-score-main">
        <span class="strength-muscles-score-value">{pointsLabel(score.score)}</span>
        {change !== undefined && <span class="strength-muted">{changeInDaysLabel(change)}</span>}
        {series.length >= 2 && (
          <span class="strength-muscles-sparkline" aria-hidden="true">
            <SparklineChart data={series} color={CHART_PRIMARY} />
          </span>
        )}
      </span>
      {extremes && <span class="strength-muted">{extremes}</span>}
    </a>
  )
}

const useSetWindows = () => {
  const period = useMemo(() => setsPeriod(new Date()), [])
  const chart = useQuery({
    queryFn: () =>
      fetchChartData({
        aggregation: 'sum',
        breakdown_fields: [`${SETS_PATH}.muscle_group`],
        bucket_size: '1d',
        end: period.end,
        measure: 'set_count',
        pattern: STRENGTH_TYPE,
        source_type: 'activity_type',
        start: period.start,
      }),
    queryKey: ['chart-data', 'strength-muscles', STRENGTH_TYPE, SETS_PATH, period],
    staleTime: FIVE_MIN,
  })
  const windows = useMemo(
    () => (chart.data ? setWindows(chart.data.breakdown_buckets ?? [], new Date()) : undefined),
    [chart.data],
  )
  return { chart, windows }
}

const MuscleList = ({
  readyPercent,
  rows,
  scoreLoaded,
  unmatched,
}: {
  readyPercent?: number
  rows: Row[]
  scoreLoaded: boolean
  unmatched: number
}) => {
  const [sort, setSort] = useState<MuscleSort>('body')
  const [open, setOpen] = useState<string | undefined>()
  const sections = useMemo(() => muscleSections(rows, sort), [rows, sort])
  const now = new Date()
  return (
    <section class="strength-muscles">
      <div class="strength-muscles-heading">
        <h2>Muscles</h2>
        <select
          aria-label="Sort"
          value={sort}
          onChange={(e) => setSort((e.target as HTMLSelectElement).value as MuscleSort)}
        >
          {MUSCLE_SORTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div class="strength-muscle-grid strength-muscles-columns" aria-hidden="true">
        <span>Muscle · last trained</span>
        <span>Recovery</span>
        <span>Sets, 7 d</span>
        <span>Score</span>
        <span />
      </div>
      {sections.map((section) => (
        <div key={section.heading ?? 'all'} class="strength-muscles-section">
          {section.heading && <h3>{section.heading}</h3>}
          <ul class="strength-muscles-list">
            {section.rows.map((row) => (
              <MuscleRow
                key={row.muscle_group}
                now={now}
                open={open === row.muscle_group}
                onToggle={() =>
                  setOpen((current) => (current === row.muscle_group ? undefined : row.muscle_group))
                }
                readyPercent={readyPercent}
                row={row}
                scoreLoaded={scoreLoaded}
              />
            ))}
          </ul>
        </div>
      ))}
      {unmatched > 0 && (
        <p class="strength-muted">
          {formatSetCount(unmatched)} sets in the last {SET_WINDOWS} weeks are from exercises not matched to
          the catalogue.{' '}
          <a href={`/activity-type/${STRENGTH_TYPE}#${unmappedSectionId(SETS_PATH)}`}>Match them</a>
        </p>
      )}
    </section>
  )
}

export function StrengthMuscles() {
  const groups = useQuery({
    queryFn: () => fetchMuscleGroups(STRENGTH_TYPE, SETS_PATH),
    queryKey: ['muscle-groups', STRENGTH_TYPE, SETS_PATH],
    staleTime: FIVE_MIN,
  })
  const { chart, windows } = useSetWindows()
  const recovery = useMuscleRecovery(STRENGTH_TYPE, SETS_PATH)
  const score = useStrengthScore(STRENGTH_TYPE, SETS_PATH)
  const history = useStrengthScoreHistory(STRENGTH_TYPE, SETS_PATH, HISTORY_DAYS)
  const plans = useOpenStrengthPlans()
  const { unfinished } = useUnfinishedSession()

  const rows = useMemo(
    () =>
      groups.data && windows
        ? muscleRows({
            groups: groups.data,
            history: history.data,
            recovery: recovery.data,
            score: score.data,
            windows,
          })
        : undefined,
    [groups.data, windows, history.data, recovery.data, score.data],
  )
  const status = statusLine(recovery.data, groups.data, new Date())
  const empty = groups.data && windows ? noStrengthSessions(groups.data, windows) : false

  return (
    <div class="page page--wide strength-page strength-page-wide strength-page-muscles">
      <StrengthHeader />
      {!unfinished && <PlannedToday plans={plans.data} recovery={recovery.data} />}
      {score.data && <ScoreCard history={history.data} score={score.data} />}
      {status && <p class="strength-muted">{status}</p>}
      {(groups.isLoading || chart.isLoading) && <p class="loading">Loading...</p>}
      {(groups.isError || chart.isError) && (
        <p class="strength-error">Your muscle groups could not be loaded.</p>
      )}
      {empty && (
        <p>
          No strength sessions yet. <a href="/strength/workouts">Start or log one</a>
        </p>
      )}
      {rows && windows && !empty && (
        <MuscleList
          readyPercent={recovery.data?.ready_percent}
          rows={rows}
          scoreLoaded={Boolean(score.data)}
          unmatched={unmatchedSets(windows)}
        />
      )}
      <p class="strength-muted strength-muscles-caption">{CAPTION}</p>
    </div>
  )
}
