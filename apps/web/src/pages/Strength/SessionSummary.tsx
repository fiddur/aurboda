import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useLocation, useRoute } from 'preact-iso'
import { useEffect, useMemo } from 'preact/hooks'

import type { Activity } from '../../state/api/types'

import { fetchActivityById, fetchMetricTimeSeries, fetchStrengthScore } from '../../state/api'
import { detailUrl, sessionUrl, SETS_PATH, STRENGTH_TYPE } from './constants'
import { useSessionHistory } from './queries'
import { isInProgress } from './sessionModel'
import { type SessionSummaryView, sessionMinutes, sessionSummaryView } from './summaryModel'
import './style.css'

const FIVE_MIN = 5 * 60 * 1000

const useScoreAt = (at: string | undefined) =>
  useQuery({
    enabled: at !== undefined,
    queryFn: () => fetchStrengthScore(STRENGTH_TYPE, SETS_PATH, at),
    queryKey: ['strength-score', STRENGTH_TYPE, SETS_PATH, at],
    retry: 1,
    staleTime: FIVE_MIN,
  })

const useActiveCalories = (id: string, start: Date | undefined, end: Date | undefined) =>
  useQuery({
    enabled: start !== undefined && end !== undefined,
    queryFn: () => fetchMetricTimeSeries('calories_active', start as Date, end as Date),
    queryKey: [
      'entity-detail',
      'activity',
      id,
      'strength-summary-calories',
      start?.toISOString(),
      end?.toISOString(),
    ],
    retry: 1,
    select: (points) => points.reduce((sum, [, v]) => sum + v, 0),
    staleTime: FIVE_MIN,
  })

/** The summary of a finished session; undefined while loading, and for one still in progress. */
const useSummary = (finished: Activity | undefined, id: string): SessionSummaryView | undefined => {
  const end = finished ? (finished.end_time ?? finished.start_time) : undefined
  const before = finished ? new Date(finished.start_time.getTime() - 1000).toISOString() : undefined
  const scoreBefore = useScoreAt(before)
  const scoreAfter = useScoreAt(end?.toISOString())
  const history = useSessionHistory(finished ? id : undefined)
  const calories = useActiveCalories(id, finished?.start_time, end)
  const settled = !scoreBefore.isLoading && !scoreAfter.isLoading && !history.isLoading
  return useMemo(
    () =>
      finished && settled
        ? sessionSummaryView({
            activeCalories: calories.data,
            activity: finished,
            history: history.data,
            scoreAfter: scoreAfter.data,
            scoreBefore: scoreBefore.data,
          })
        : undefined,
    [finished, settled, calories.data, history.data, scoreAfter.data, scoreBefore.data],
  )
}

const SummaryPage = ({
  activity,
  id,
  view,
}: {
  activity: Activity
  id: string
  view: SessionSummaryView
}) => (
  <div class="page page--narrow strength-page strength-summary">
    <h1>{view.headline}</h1>
    <p class="strength-muted">
      {format(activity.start_time, 'EEE d MMM, HH:mm')} ·{' '}
      {sessionMinutes(activity.start_time, activity.end_time)} min
    </p>
    {view.highlights.length > 0 && (
      <ul class="strength-summary-highlights">
        {view.highlights.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    )}
    <dl class="strength-card strength-summary-stats">
      {view.stats.map((stat) => (
        <div key={stat.label}>
          <dt class="strength-muted">{stat.label}</dt>
          <dd>{stat.value}</dd>
        </div>
      ))}
    </dl>
    {view.exercises.length > 0 && (
      <ul class="strength-summary-exercises">
        {view.exercises.map((exercise, i) => (
          <li key={i} class="strength-card">
            <h2>{exercise.name}</h2>
            <p class="strength-muted">{exercise.summary}</p>
            {exercise.records.length > 0 && (
              <p class="strength-summary-records">{exercise.records.join(' · ')}</p>
            )}
          </li>
        ))}
      </ul>
    )}
    <div class="strength-row-actions">
      <a class="btn-primary" href="/strength">
        Back to Strength
      </a>
      <a class="btn-secondary" href={detailUrl(id)}>
        Open the session
      </a>
    </div>
  </div>
)

export function StrengthSessionSummary() {
  const { params } = useRoute()
  const { route } = useLocation()
  const id = params.id as string
  const query = useQuery({
    queryFn: () => fetchActivityById(id),
    queryKey: ['entity-detail', 'activity', id, 'strength'],
    retry: 1,
  })
  const activity = query.data?.activity
  const inProgress = activity ? isInProgress(activity.data) : false
  const finished = inProgress ? undefined : activity
  const view = useSummary(finished, id)

  useEffect(() => {
    if (inProgress) route(sessionUrl(id), true)
  }, [inProgress, id, route])

  if (query.isError || (query.isSuccess && !activity)) {
    return <p class="error">The session could not be loaded.</p>
  }
  if (!finished || !view) return <p class="loading">Loading…</p>
  return <SummaryPage activity={finished} id={id} view={view} />
}
