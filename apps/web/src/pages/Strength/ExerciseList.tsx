import type {
  ActivityMeasure,
  ActivitySessionGroup,
  DataItemFieldDefinition,
  ExerciseEquipment,
  ExerciseMuscleGroup,
  StrengthScore,
} from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useLocation } from 'preact-iso'
import { useState } from 'preact/hooks'

import type { ItemGroupSortKey } from '../ActivityTypeMeta/itemGroups'

import { fieldLabel, type ListFieldDefinition } from '../../components/sessions/sessionView'
import { fetchActivitySessions } from '../../state/api'
import { formatBestSet, formatMeasure } from '../../utils/measures'
import { ItemValueAliases } from '../ActivityTypeMeta/ItemGroupsSection'
import { unmappedSectionId } from '../ActivityTypeMeta/UnmappedItemValuesSection'
import { useStrengthScore } from '../StrengthScore/queries'
import { exerciseItemUrl, SETS_PATH, STRENGTH_TYPE } from './constants'
import {
  equipmentOptions,
  exercisePoints,
  exerciseSummaryLine,
  filterExercises,
  liftsNotDone,
  muscleGroupOptions,
  muscleSearch,
  musclesLabel,
  muscleSplitLine,
  parseMuscleParam,
} from './exercisesModel'

const LOOKBACK_OPTIONS = [
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
  { label: '2 years', value: 730 },
  { label: 'All time', value: 0 },
]

const SORT_OPTIONS: { label: string; value: ItemGroupSortKey }[] = [
  { label: 'Recently done', value: 'recent' },
  { label: 'Most done', value: 'count' },
  { label: 'Best e1RM', value: 'e1rm' },
  { label: 'Max weight', value: 'max_weight' },
  { label: 'Best set', value: 'best_set' },
  { label: 'Volume', value: 'volume' },
  { label: 'Points', value: 'points' },
  { label: 'Name', value: 'name' },
]

const POINTS_TITLE = 'Strength score points, from your best set of the last 90 days'

const UNMATCHED_HREF = `/activity-type/${STRENGTH_TYPE}#${unmappedSectionId(SETS_PATH)}`

const Muscles = ({ group }: { group: ActivitySessionGroup }) => {
  if (group.catalog_key === undefined) {
    return (
      <a class="strength-exercise-muscles strength-exercise-unmatched" href={UNMATCHED_HREF}>
        Not matched
      </a>
    )
  }
  const { more, primary, secondary } = musclesLabel(group)
  if (primary.length === 0 && secondary.length === 0) return null
  return (
    <span class="strength-exercise-muscles">
      {primary.join(', ')}
      {primary.length > 0 && secondary.length > 0 && ', '}
      {secondary.length > 0 && <span class="strength-exercise-muted">{secondary.join(', ')}</span>}
      {more > 0 && <span class="strength-exercise-muted"> +{more}</span>}
    </span>
  )
}

const Points = ({ group, score }: { group: ActivitySessionGroup; score: StrengthScore | undefined }) => {
  const points = exercisePoints(score, group.catalog_key)
  if (!points) return <>–</>
  return <span class={points.counted ? undefined : 'strength-exercise-muted'}>{points.points}</span>
}

const Name = ({ group, noValueLabel }: { group: ActivitySessionGroup; noValueLabel: string }) =>
  group.value === null ? (
    <span class="strength-exercise-muted">{noValueLabel}</span>
  ) : (
    <a class="strength-exercise-name" href={exerciseItemUrl(String(group.value))}>
      {String(group.value)}
    </a>
  )

const measure = (group: ActivitySessionGroup, m: ActivityMeasure): string => {
  const value = group.measures?.[m]
  return value === undefined ? '–' : formatMeasure(m, value)
}

const ExerciseTable = ({
  groups,
  noValueLabel,
  score,
}: {
  groups: ActivitySessionGroup[]
  noValueLabel: string
  score: StrengthScore | undefined
}) => (
  <div class="strength-exercises-wide">
    <table class="strength-exercises-table">
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col" class="strength-exercise-num">
            Done
          </th>
          <th scope="col">Last</th>
          <th scope="col" class="strength-exercise-num" title="Best estimated one-rep max (Epley)">
            Best e1RM
          </th>
          <th scope="col" class="strength-exercise-num">
            Max weight
          </th>
          <th scope="col" class="strength-exercise-num" title="The working set the best e1RM comes from">
            Best set
          </th>
          <th scope="col" class="strength-exercise-num" title="Weight × reps over the period">
            Volume
          </th>
          <th scope="col" class="strength-exercise-num" title="Working sets over the period">
            Sets
          </th>
          <th scope="col" class="strength-exercise-num" title={POINTS_TITLE}>
            Points
          </th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <tr key={JSON.stringify(g.value)}>
            <td class="strength-exercise-label">
              <Name group={g} noValueLabel={noValueLabel} />
              {g.value !== null && <Muscles group={g} />}
            </td>
            <td class="strength-exercise-num">{g.count}×</td>
            <td class="strength-exercise-date">{format(new Date(g.last_start_time), 'yyyy-MM-dd')}</td>
            <td class="strength-exercise-num">{measure(g, 'e1rm')}</td>
            <td class="strength-exercise-num">{measure(g, 'max_weight')}</td>
            <td class="strength-exercise-num">{g.best_set ? formatBestSet(g.best_set) : '–'}</td>
            <td class="strength-exercise-num">{measure(g, 'volume')}</td>
            <td class="strength-exercise-num">{measure(g, 'set_count')}</td>
            <td class="strength-exercise-num">
              <Points group={g} score={score} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

const ExerciseRows = ({
  groups,
  noValueLabel,
  score,
}: {
  groups: ActivitySessionGroup[]
  noValueLabel: string
  score: StrengthScore | undefined
}) => (
  <ul class="strength-exercises-narrow">
    {groups.map((g) => (
      <li key={JSON.stringify(g.value)} class="strength-exercise-row">
        <div class="strength-exercise-line">
          <Name group={g} noValueLabel={noValueLabel} />
          <span class="strength-exercise-points" title={POINTS_TITLE}>
            <Points group={g} score={score} />
          </span>
        </div>
        {g.value !== null && (
          <div>
            <Muscles group={g} />
          </div>
        )}
        <div class="strength-exercise-muted">{exerciseSummaryLine(g)}</div>
      </li>
    ))}
  </ul>
)

const NotDone = ({
  muscle,
  score,
}: {
  muscle: ExerciseMuscleGroup | undefined
  score: StrengthScore | undefined
}) => {
  const notDone = liftsNotDone(score, muscle)
  if (!notDone) return null
  return (
    <div class="strength-exercises-not-done">
      <h3>Not done in the last 90 days</h3>
      <p class="strength-exercise-muted">These lifts count toward the {notDone.group.name} score.</p>
      <ul>
        {notDone.lifts.map((l) => (
          <li key={l.lift}>{l.name}</li>
        ))}
      </ul>
    </div>
  )
}

/** The strength exercises of a period, filtered by name, muscle group and equipment. */
export function ExerciseList({ item, list }: { item: DataItemFieldDefinition; list: ListFieldDefinition }) {
  const { query: urlQuery } = useLocation()
  const [lookback, setLookback] = useState(90)
  const [sortKey, setSortKey] = useState<ItemGroupSortKey>('recent')
  const [search, setSearch] = useState('')
  const [muscle, setMuscle] = useState<ExerciseMuscleGroup | undefined>(() => parseMuscleParam(urlQuery))
  const [equipment, setEquipment] = useState<ExerciseEquipment | undefined>(undefined)

  const sessions = useQuery({
    queryFn: () =>
      fetchActivitySessions(STRENGTH_TYPE, {
        group_by: SETS_PATH,
        start: lookback > 0 ? new Date(Date.now() - lookback * 86_400_000).toISOString() : undefined,
      }),
    queryKey: ['activity-sessions', STRENGTH_TYPE, SETS_PATH, 'groups', lookback],
    staleTime: 5 * 60 * 1000,
  })
  const scoreQuery = useStrengthScore(STRENGTH_TYPE, SETS_PATH)
  const score = scoreQuery.data ?? undefined

  const groups = sessions.data?.groups ?? []
  const pointsOf = (g: ActivitySessionGroup) => exercisePoints(score, g.catalog_key)?.points
  const { shown, split } = filterExercises(groups, { equipment, muscle, pointsOf, query: search, sortKey })
  const equipmentChoices = equipmentOptions(groups)
  const noValueLabel = `No ${fieldLabel(item).toLowerCase()}`

  const chooseMuscle = (value: string) => {
    const next = parseMuscleParam({ muscle: value })
    setMuscle(next)
    history.replaceState(
      history.state,
      '',
      `${window.location.pathname}${muscleSearch(window.location.search, next)}`,
    )
  }

  return (
    <section class="strength-exercises">
      <h2>Your exercises</h2>
      <div class="strength-exercises-controls">
        <input
          type="search"
          class="strength-exercises-search"
          aria-label={`Filter by ${fieldLabel(item).toLowerCase()}`}
          placeholder="Search"
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
        />
        <label>
          Muscle group
          <select value={muscle ?? ''} onChange={(e) => chooseMuscle((e.target as HTMLSelectElement).value)}>
            <option value="">All muscles</option>
            {muscleGroupOptions().map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Equipment
          <select
            value={equipment ?? ''}
            onChange={(e) =>
              setEquipment(
                ((e.target as HTMLSelectElement).value || undefined) as ExerciseEquipment | undefined,
              )
            }
          >
            <option value="">Any equipment</option>
            {equipmentChoices.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Period
          <select
            value={lookback}
            onChange={(e) => setLookback(Number((e.target as HTMLSelectElement).value))}
          >
            {LOOKBACK_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort
          <select
            value={sortKey}
            onChange={(e) => setSortKey((e.target as HTMLSelectElement).value as ItemGroupSortKey)}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {sessions.isLoading && <p class="loading">Loading...</p>}
      {sessions.isError && <p class="error">Failed to load sessions</p>}
      {sessions.data &&
        (groups.length === 0 ? (
          <p class="activity-type-meta-empty">
            No sessions with {fieldLabel(list).toLowerCase()} in this period.
          </p>
        ) : (
          <>
            {muscle !== undefined && split && (
              <p class="strength-exercises-split">{muscleSplitLine(split, muscle)}</p>
            )}
            {shown.length === 0 ? (
              split && split.mainly + split.also === 0 ? null : (
                <p class="strength-exercise-muted">No match.</p>
              )
            ) : (
              <>
                <ExerciseTable groups={shown} noValueLabel={noValueLabel} score={score} />
                <ExerciseRows groups={shown} noValueLabel={noValueLabel} score={score} />
              </>
            )}
          </>
        ))}
      <NotDone muscle={muscle} score={score} />
      <ItemValueAliases name={STRENGTH_TYPE} path={SETS_PATH} />
    </section>
  )
}
