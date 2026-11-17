import type { MuscleGroupExercise, MuscleGroupSession } from '@aurboda/api-spec'

import { format } from 'date-fns'
import { useState } from 'preact/hooks'

import { itemPageHref } from '../../components/sessions/sessionView'
import { formatMeasure, formatSetCount } from '../../utils/measures'
import { recruitmentLabel } from './muscleGroupView'
import '../../components/sessions/sessions.css'

const PAGE = 25

const day = (iso: string): string => format(new Date(iso), 'yyyy-MM-dd')

const ExerciseRow = ({ exercise, href }: { exercise: MuscleGroupExercise; href: string }) => {
  const done = exercise.session_count > 0
  const sets = exercise.measures.set_count
  return (
    <tr class={done ? undefined : 'muscle-group-idle'}>
      <td>
        <a href={href}>{exercise.value}</a>
      </td>
      <td class="session-num">{recruitmentLabel(exercise.weight)}</td>
      <td class="session-num">{done && sets !== undefined ? formatSetCount(sets) : '–'}</td>
      <td class="session-num session-opt">{done ? exercise.session_count : '–'}</td>
      <td class="session-date">{day(exercise.last_time)}</td>
    </tr>
  )
}

/** Every exercise that trains the group: its recruitment, and its sets and sessions in the period. */
export const ExercisesTable = ({
  exercises,
  field,
  name,
}: {
  exercises: MuscleGroupExercise[]
  field: string
  name: string
}) => (
  <div class="sessions-table-wrap">
    <table class="sessions-table">
      <thead>
        <tr>
          <th scope="col">Exercise</th>
          <th scope="col" class="session-num" title="How much the exercise recruits the muscle group">
            Recruitment
          </th>
          <th scope="col" class="session-num" title="Sets in the period, weighted by recruitment">
            Sets
          </th>
          <th scope="col" class="session-num session-opt">
            Sessions
          </th>
          <th scope="col">Last done</th>
        </tr>
      </thead>
      <tbody>
        {exercises.map((exercise) => (
          <ExerciseRow
            key={exercise.value}
            exercise={exercise}
            href={itemPageHref(name, field, exercise.value)}
          />
        ))}
      </tbody>
    </table>
  </div>
)

const SessionRow = ({ session }: { session: MuscleGroupSession }) => {
  const { set_count: sets, volume } = session.measures
  return (
    <tr>
      <td class="session-date">
        <a href={`/detail/activity/${session.id}`}>{day(session.start_time)}</a>
      </td>
      <td>{session.exercises.join(', ')}</td>
      <td class="session-num">{sets === undefined ? '–' : formatSetCount(sets)}</td>
      <td class="session-num session-opt">{volume === undefined ? '–' : formatMeasure('volume', volume)}</td>
    </tr>
  )
}

/** The period's sessions that trained the group, newest first, a page at a time. */
export const SessionsTable = ({ sessions }: { sessions: MuscleGroupSession[] }) => {
  const [shown, setShown] = useState(PAGE)
  return (
    <div class="sessions-table-wrap">
      <table class="sessions-table">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Exercises</th>
            <th scope="col" class="session-num" title="Weighted by recruitment">
              Sets
            </th>
            <th scope="col" class="session-num session-opt" title="Weighted by recruitment">
              Volume
            </th>
          </tr>
        </thead>
        <tbody>
          {sessions.slice(0, shown).map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </tbody>
      </table>
      {sessions.length > shown && (
        <button type="button" class="session-more" onClick={() => setShown((n) => n + PAGE)}>
          Show more ({sessions.length - shown} left)
        </button>
      )}
    </div>
  )
}
