import { exerciseMuscleInfo, type StrengthScoreGroupResult, type StrengthScoreLift } from '@aurboda/api-spec'
import { Fragment } from 'preact'

import { itemPageHref, muscleGroupHref } from '../../components/sessions/sessionView'
import { liftDetailParts, liftNote, liftNoteLabel, pointsLabel } from './strengthScoreView'

const LiftRow = ({
  field,
  lift,
  name,
  now,
}: {
  field: string
  lift: StrengthScoreLift
  name: string
  now: Date
}) => {
  const { best } = lift
  if (!best) return null
  const detail = liftDetailParts(best)
  const note = liftNoteLabel(lift, now)
  const expiring = liftNote(lift, now) === 'expiring'
  return (
    <li class="strength-score-lift">
      <div class="strength-score-row">
        <a href={itemPageHref(name, field, best.value)}>{lift.name}</a>
        <span class="strength-score-points">{pointsLabel(lift.score)}</span>
      </div>
      <div class="strength-score-muted">
        {detail.set} on <a href={`/detail/activity/${best.session_id}`}>{detail.day}</a>
        {detail.rest}
        {note && (
          <>
            {' · '}
            <span class={expiring ? 'strength-score-expiring' : undefined}>{note}</span>
          </>
        )}
      </div>
    </li>
  )
}

const MuscleLinks = ({
  field,
  group,
  name,
}: {
  field: string
  group: StrengthScoreGroupResult
  name: string
}) => (
  <p class="strength-score-muted strength-score-muscles">
    Sets and sessions:{' '}
    {group.muscle_groups.map((mg, i) => (
      <Fragment key={mg}>
        {i > 0 && ' · '}
        <a href={muscleGroupHref(name, field, mg)}>{exerciseMuscleInfo[mg].name}</a>
      </Fragment>
    ))}
  </p>
)

export const GroupSection = ({
  field,
  group,
  name,
}: {
  field: string
  group: StrengthScoreGroupResult
  name: string
}) => {
  const now = new Date()
  const done = group.lifts.filter((l) => l.best !== undefined)
  const rest = group.lifts.filter((l) => l.best === undefined)
  return (
    <section class="activity-type-item-section">
      <div class="strength-score-row strength-score-group-heading">
        <h2>{group.name}</h2>
        <span class="strength-score-points">{pointsLabel(group.score)}</span>
      </div>
      <MuscleLinks field={field} group={group} name={name} />
      {done.length === 0 && (
        <p class="activity-type-item-empty">
          No weighted set of a lift that counts toward {group.name} in the last 90 days.
        </p>
      )}
      {done.length > 0 && (
        <ul class="strength-score-lifts">
          {done.map((l) => (
            <LiftRow key={l.lift} field={field} lift={l} name={name} now={now} />
          ))}
        </ul>
      )}
      {rest.length > 0 && (
        <details class="strength-score-more" open={done.length === 0}>
          <summary>
            {rest.length} more {rest.length === 1 ? 'lift counts' : 'lifts count'} toward {group.name}
          </summary>
          <p class="strength-score-muted">{rest.map((l) => l.name).join(', ')}</p>
        </details>
      )}
    </section>
  )
}
