import { type ExerciseMuscleGroup, exerciseMuscleInfo, type MuscleGroupHistory } from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'
import { useMemo, useState } from 'preact/hooks'

import { formatDay } from '../../components/RecordCard'
import { muscleGroupsHref } from '../../components/sessions/sessionView'
import { fetchActivityTypeDefinitions, fetchMuscleGroupHistory } from '../../state/api'
import { toDisplayName } from '../../utils/displayName'
import { formatSetCount } from '../../utils/measures'
import { MuscleGroupChart } from './MuscleGroupChart'
import { ExercisesTable, SessionsTable } from './MuscleGroupTables'
import {
  averagePerWeek,
  isMuscleGroup,
  lastTrainedLabel,
  MUSCLE_GROUP_PERIODS,
  muscleGroupPeriod,
  setsThisWeek,
} from './muscleGroupView'
import '../ActivityTypeItem/style.css'
import './style.css'

const Card = ({ detail, label, value }: { detail?: string; label: string; value: string }) => (
  <div class="activity-type-item-card">
    <div class="activity-type-item-card-label">{label}</div>
    <div class="activity-type-item-card-value">{value}</div>
    {detail && <div class="activity-type-item-card-detail">{detail}</div>}
  </div>
)

const Cards = ({ history, periodDays }: { history: MuscleGroupHistory; periodDays: number }) => {
  const now = new Date()
  return (
    <div class="activity-type-item-cards">
      <Card label="Sets this week" value={formatSetCount(setsThisWeek(history.sessions, now))} />
      <Card
        label="Avg sets / week"
        value={formatSetCount(averagePerWeek(history.totals.set_count ?? 0, periodDays))}
      />
      <Card
        label="Last trained"
        value={lastTrainedLabel(history.last_trained, now)}
        detail={history.last_trained === null ? undefined : formatDay(history.last_trained)}
      />
    </div>
  )
}

const History = ({
  field,
  group,
  name,
  periodDays,
}: {
  field: string
  group: ExerciseMuscleGroup
  name: string
  periodDays: number
}) => {
  const groupName = exerciseMuscleInfo[group].name
  const period = useMemo(() => muscleGroupPeriod(periodDays, new Date()), [periodDays])
  const query = useQuery({
    queryFn: () => fetchMuscleGroupHistory(name, group, { end: period.end, field, start: period.start }),
    queryKey: ['muscle-group-history', name, field, group, period.start, period.end],
    staleTime: 5 * 60 * 1000,
  })
  const history = query.data

  if (query.isLoading) return <p class="loading">Loading...</p>
  if (query.isError || !history) return <p class="error">Failed to load the muscle group</p>
  return (
    <>
      <Cards history={history} periodDays={periodDays} />
      <MuscleGroupChart
        field={field}
        group={group}
        groupName={groupName}
        lookbackDays={periodDays}
        name={name}
        period={period}
      />
      <section class="activity-type-item-section">
        <h2>Exercises that train {groupName}</h2>
        {history.exercises.length === 0 ? (
          <p class="activity-type-item-empty">No logged exercise trains {groupName}.</p>
        ) : (
          <ExercisesTable exercises={history.exercises} field={field} name={name} />
        )}
      </section>
      <section class="activity-type-item-section">
        <h2>Sessions</h2>
        {history.sessions.length === 0 ? (
          <p class="activity-type-item-empty">No sessions in this period.</p>
        ) : (
          <SessionsTable sessions={history.sessions} />
        )}
      </section>
    </>
  )
}

/** One muscle group of a type across its sessions: its sets over time, the exercises that train it and when. */
export function MuscleGroup() {
  const { params } = useRoute()
  const name = params.name as string
  const field = params.field as string
  const group = params.group as string
  const [periodDays, setPeriodDays] = useState(MUSCLE_GROUP_PERIODS[0].value)

  const { data: definitions } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activityTypeDefinitions'],
    staleTime: 5 * 60 * 1000,
  })
  const typeName = definitions?.find((d) => d.name === name)?.display_name ?? toDisplayName(name)
  const known = isMuscleGroup(group)

  return (
    <div class="activity-type-item-page">
      <a href={muscleGroupsHref(name, field)} class="activity-type-item-back">
        ← {typeName}
      </a>
      {known ? (
        <>
          <header class="activity-type-item-header">
            <h1>{exerciseMuscleInfo[group].name}</h1>
            <p class="activity-type-item-subtitle">Muscle group · {typeName}</p>
          </header>
          <label class="activity-type-item-period">
            Period
            <select
              value={periodDays}
              onChange={(e) => setPeriodDays(Number((e.target as HTMLSelectElement).value))}
            >
              {MUSCLE_GROUP_PERIODS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <History field={field} group={group} name={name} periodDays={periodDays} />
        </>
      ) : (
        <p class="activity-type-item-empty">Unknown muscle group.</p>
      )}
    </div>
  )
}
