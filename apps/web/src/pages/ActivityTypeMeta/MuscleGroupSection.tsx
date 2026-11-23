import type { ExerciseMuscleGroup } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import { muscleGroupHref, muscleGroupsSectionId } from '../../components/sessions/sessionView'
import { fetchMuscleGroups } from '../../state/api'
import { lastTrainedLabel } from '../MuscleGroup/muscleGroupView'
import { MuscleGroupSetsChart, MuscleGroupSetsControls, useMuscleGroupSets } from './muscleGroupSets'
import { muscleGroupSummary, type MuscleGroupSummaryRow } from './muscleGroupSummary'
import { unmappedSectionId } from './UnmappedItemValuesSection'
import '../../components/sessions/sessions.css'

const sets = (value: number): string => String(Math.round(value * 10) / 10)

type LastTrained = Partial<Record<ExerciseMuscleGroup, string | null>>

const RowName = ({
  name,
  path,
  row,
  unmappedHref,
}: {
  name: string
  path: string
  row: MuscleGroupSummaryRow
  unmappedHref: string
}) => {
  if (row.kind === 'not_in_catalogue') return <a href={unmappedHref}>{row.name}</a>
  if (row.muscle_group) return <a href={muscleGroupHref(name, path, row.muscle_group)}>{row.name}</a>
  return <>{row.name}</>
}

const LastTrainedCell = ({ lastTrained, row }: { lastTrained?: LastTrained; row: MuscleGroupSummaryRow }) => {
  const known = lastTrained && row.muscle_group && row.muscle_group in lastTrained
  if (!known || !row.muscle_group) return <span class="activity-type-meta-muscle-summary-value" />
  const iso = lastTrained[row.muscle_group] ?? null
  const now = new Date()
  return (
    <span class="activity-type-meta-muscle-summary-value activity-type-meta-muscle-summary-last">
      <span class="activity-type-meta-muscle-summary-long">{lastTrainedLabel(iso, now)}</span>
      <span class="activity-type-meta-muscle-summary-short">{lastTrainedLabel(iso, now, 'short')}</span>
    </span>
  )
}

const SummaryRow = ({
  lastTrained,
  name,
  path,
  row,
  unmappedHref,
}: {
  lastTrained?: LastTrained
  name: string
  path: string
  row: MuscleGroupSummaryRow
  unmappedHref: string
}) => (
  <li
    class={`activity-type-meta-muscle-summary-row${row.trained ? '' : ' activity-type-meta-muscle-summary-untrained'}`}
  >
    <span class="activity-type-meta-muscle-summary-name">
      <RowName name={name} path={path} row={row} unmappedHref={unmappedHref} />
    </span>
    <span
      class="activity-type-meta-muscle-summary-bar activity-type-meta-muscle-summary-bar-slot"
      aria-hidden="true"
    >
      <span style={{ width: `${row.bar * 100}%` }} />
    </span>
    <span class="activity-type-meta-muscle-summary-value">{sets(row.this_week)}</span>
    <span class="activity-type-meta-muscle-summary-value">{sets(row.per_week)}</span>
    <LastTrainedCell lastTrained={lastTrained} row={row} />
  </li>
)

const useLastTrained = (name: string, path: string): LastTrained | undefined => {
  const { data } = useQuery({
    queryFn: () => fetchMuscleGroups(name, path),
    queryKey: ['muscle-groups', name, path],
    staleTime: 5 * 60 * 1000,
  })
  return useMemo(
    () => (data ? Object.fromEntries(data.groups.map((g) => [g.muscle_group, g.last_trained])) : undefined),
    [data],
  )
}

/**
 * Working sets of a catalogue-backed item field per muscle group, each set weighted by recruitment:
 * a list of this week's and the average week's sets per group, and the weekly chart on request.
 */
export function MuscleGroupSection({
  name,
  path,
  unmappedHref = `#${unmappedSectionId(path)}`,
}: {
  name: string
  path: string
  unmappedHref?: string
}) {
  const weekly = useMuscleGroupSets(name, path)
  const { buckets, lookback, multiSeries, query, range, series } = weekly
  const [showChart, setShowChart] = useState(false)
  const summary = useMemo(
    () => (buckets ? muscleGroupSummary({ buckets, now: new Date(), period_days: lookback }) : []),
    [buckets, lookback],
  )

  const lastTrained = useLastTrained(name, path)

  const sectionId = muscleGroupsSectionId(path)
  const scrolled = useRef(false)
  const loaded = query.data !== undefined
  useEffect(() => {
    if (scrolled.current || !loaded || window.location.hash !== `#${sectionId}`) return
    scrolled.current = true
    document.getElementById(sectionId)?.scrollIntoView({ block: 'start' })
  }, [loaded, sectionId])

  return (
    <section id={sectionId} class="activity-type-meta-section">
      <div class="activity-type-meta-section-header sessions-header">
        <h2>Sets per muscle group</h2>
        <MuscleGroupSetsControls sets={weekly} />
      </div>

      {query.isLoading && <p class="loading">Loading...</p>}
      {query.isError && <p class="error">Failed to load sets per muscle group</p>}
      {query.data &&
        (series && multiSeries ? (
          <>
            <ul class="activity-type-meta-muscle-summary" aria-label="Sets per muscle group">
              <li class="activity-type-meta-muscle-summary-row activity-type-meta-muscle-summary-head">
                <span class="activity-type-meta-muscle-summary-name">Muscle group</span>
                <span class="activity-type-meta-muscle-summary-bar-slot" />
                <span class="activity-type-meta-muscle-summary-value">This week</span>
                <span class="activity-type-meta-muscle-summary-value">Avg / week</span>
                <span class="activity-type-meta-muscle-summary-value">Last trained</span>
              </li>
              {summary.map((row) => (
                <SummaryRow
                  key={row.name}
                  lastTrained={lastTrained}
                  name={name}
                  path={path}
                  row={row}
                  unmappedHref={unmappedHref}
                />
              ))}
            </ul>
            <button
              type="button"
              class="btn-secondary activity-type-meta-muscle-summary-toggle"
              aria-expanded={showChart}
              onClick={() => setShowChart((open) => !open)}
            >
              {showChart ? 'Hide weekly chart' : 'Show weekly chart'}
            </button>
            {showChart && <MuscleGroupSetsChart multiSeries={multiSeries} range={range} series={series} />}
          </>
        ) : (
          <p class="activity-type-meta-empty">No sets in this period.</p>
        ))}
    </section>
  )
}
