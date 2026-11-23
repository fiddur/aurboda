import type { StrengthScore, StrengthScoreHistory } from '@aurboda/api-spec'

import { itemPageHref } from '../../components/sessions/sessionView'
import {
  MuscleGroupSetsChart,
  MuscleGroupSetsControls,
  useMuscleGroupSets,
} from '../ActivityTypeMeta/muscleGroupSets'
import { changeLabel, leavesIn, liftDetailParts, pointsLabel } from '../StrengthScore/strengthScoreView'
import { leavingSoon, type MovedRow, movedGroups } from './progressModel'

const changeClass = (change: number): string => (change > 0 ? 'strength-muscle-up' : 'strength-muscle-down')

const Scores = ({ row }: { row: MovedRow }) => {
  if (row.before === undefined) return <span>first score {pointsLabel(row.now_score)}</span>
  if (row.now_score === null) return <span>{row.before} → no score</span>
  return (
    <span>
      {row.before} → {row.now_score}
      {row.change !== undefined && (
        <span class={`strength-progress-change ${changeClass(row.change)}`}>{changeLabel(row.change)}</span>
      )}
    </span>
  )
}

const Reason = ({ row }: { row: MovedRow }) => {
  const reason = row.reason
  if (!reason) return null
  if (reason.kind === 'all_left') return <p class="strength-muted">Every lift left the 90 days.</p>
  if (reason.kind === 'lift_left') {
    return (
      <p class="strength-muted">
        A better lift left the 90 days.
        {reason.best_now &&
          ` Best now: ${reason.best_now.name}, ${liftDetailParts(reason.best_now.best).set}.`}
      </p>
    )
  }
  const { best } = reason.lift
  const { day, set } = liftDetailParts(best)
  return (
    <p class="strength-muted">
      New best: {reason.lift.name}, {set} on <a href={`/detail/activity/${best.session_id}`}>{day}</a>
    </p>
  )
}

export const MovedSection = ({ history, score }: { history: StrengthScoreHistory; score: StrengthScore }) => {
  const moved = movedGroups(score, history, new Date())
  if (moved.rows.length === 0 && moved.unchanged.length === 0) return null
  return (
    <section class="activity-type-item-section">
      <h2>What moved in 30 days</h2>
      {moved.rows.length === 0 ? (
        <p>No muscle group's score changed in the last 30 days.</p>
      ) : (
        <ul class="strength-progress-list">
          {moved.rows.map((row) => (
            <li key={row.group} class="strength-progress-item">
              <div class="strength-progress-row">
                <strong>{row.name}</strong>
                <Scores row={row} />
              </div>
              <Reason row={row} />
            </li>
          ))}
        </ul>
      )}
      {(moved.unchanged.length > 0 || moved.no_score.length > 0) && (
        <p class="strength-muted strength-progress-closing">
          {[
            ...(moved.unchanged.length > 0 ? [`Unchanged: ${moved.unchanged.join(', ')}.`] : []),
            ...(moved.no_score.length > 0 ? [`No score yet: ${moved.no_score.join(', ')}.`] : []),
          ].join(' ')}
        </p>
      )}
    </section>
  )
}

export const LeavingSection = ({
  field,
  name,
  score,
}: {
  field: string
  name: string
  score: StrengthScore
}) => {
  const now = new Date()
  const leaving = leavingSoon(score, now)
  if (leaving.length === 0) return null
  return (
    <section class="activity-type-item-section">
      <h2>Leaving the 90 days soon</h2>
      <p class="strength-muted">
        A best set counts for 90 days. Do these lifts again before they leave, or a lower set takes their
        place.
      </p>
      <ul class="strength-progress-list">
        {leaving.map((l) => (
          <li key={l.lift.lift} class="strength-progress-item">
            <div class="strength-progress-row">
              <a href={itemPageHref(name, field, l.lift.best.value)}>{l.lift.name}</a>
              <span class="strength-score-points">{pointsLabel(l.lift.score)}</span>
            </div>
            <p class="strength-muted">
              {l.groups.join(', ')} · {liftDetailParts(l.lift.best).set} · leaves {leavesIn(l.days)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}

export const SetsPerWeekSection = ({ name, path }: { name: string; path: string }) => {
  const sets = useMuscleGroupSets(name, path)
  const { multiSeries, query, range, series } = sets
  return (
    <section class="activity-type-item-section">
      <div class="activity-type-item-section-header sessions-header">
        <h2>Sets per week</h2>
        <MuscleGroupSetsControls sets={sets} />
      </div>
      {query.isLoading && <p class="loading">Loading...</p>}
      {query.isError && <p class="error">Failed to load sets per muscle group</p>}
      {query.data &&
        (series && multiSeries ? (
          <MuscleGroupSetsChart multiSeries={multiSeries} range={range} series={series} stacked />
        ) : (
          <p class="activity-type-item-empty">No sets in this period.</p>
        ))}
    </section>
  )
}
