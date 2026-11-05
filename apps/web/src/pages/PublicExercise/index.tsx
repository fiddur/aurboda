import type { PublicSharedExerciseResponse, SharedExerciseData } from '@aurboda/api-spec'

import { activityMeasureLabels } from '@aurboda/api-spec'
import { useMemo } from 'preact/hooks'

import { AttributionLink } from '../../components/AttributionLink'
import { BarChart } from '../../components/charts/BarChart'
import { TrendLineChart } from '../../components/charts/TrendLineChart'
import { itemPageHref } from '../../components/sessions/sessionView'
import { CopyLinkButton, NativeShareButton } from '../../components/ShareLinkButton'
import { DoneCard, RecordCard } from '../ActivityTypeItem/ItemCards'
import { ItemSessionsTable } from '../ActivityTypeItem/ItemSessionsTable'
import '../ActivityTypeItem/style.css'
import './style.css'

/**
 * The exercise's one chart: weekly bars of the per-week measure with the
 * decaying-best line over them when the trend tracks the same measure (#1397).
 * Falls back to the trend line alone where no bars could be built.
 */
export function ExerciseChart({
  perWeek,
  trend,
}: Pick<SharedExerciseData, 'trend'> & { perWeek: SharedExerciseData['per_week'] }) {
  const lineTrend = trend && perWeek && trend.measure === perWeek.measure ? trend : undefined
  const line = useMemo(() => (lineTrend ? { data: lineTrend.history } : undefined), [lineTrend])

  if (perWeek) {
    return (
      <section class="activity-type-item-section">
        <h2>{activityMeasureLabels[perWeek.measure]}</h2>
        <BarChart
          data={perWeek.buckets}
          color="#8b5cf6"
          height={220}
          bucketSize="1w"
          rangeStart={perWeek.start}
          rangeEnd={perWeek.end}
          line={line}
        />
        <p class="activity-type-item-caption">
          {lineTrend
            ? `${activityMeasureLabels[perWeek.measure]} of each week; the line is the decaying best, with a ${lineTrend.half_life_days}-day half-life between sessions.`
            : `${activityMeasureLabels[perWeek.measure]}, ${perWeek.aggregation === 'max' ? 'the best' : 'the total'} of each week.`}
        </p>
      </section>
    )
  }
  if (!trend) return null
  return (
    <section class="activity-type-item-section">
      <h2>Trend</h2>
      <TrendLineChart data={trend.history} color="#8b5cf6" height={220} />
      <p class="activity-type-item-caption">
        {activityMeasureLabels[trend.measure]}, decaying with a {trend.half_life_days}-day half-life between
        sessions.
      </p>
    </section>
  )
}

/** One shared exercise, read-only, from the server-resolved projection of its sessions. */
export function PublicExercise({
  data,
  isOwner,
  resource,
  username,
}: {
  data: SharedExerciseData
  isOwner: boolean
  resource: PublicSharedExerciseResponse
  username: string
}) {
  const name = resource.name ?? resource.value ?? 'Exercise'
  const { done, history, per_week: perWeek, records, trend } = data

  return (
    <div class="public-dashboard">
      <header class="public-exercise-header">
        <h1>{name}</h1>
        <AttributionLink username={username} />
        <div class="public-exercise-actions">
          <CopyLinkButton url={window.location.href} />
          <NativeShareButton url={window.location.href} title={`${name} — Aurboda`} />
          {isOwner && resource.activity_type && resource.field && resource.value && (
            <a
              class="public-exercise-manage"
              href={itemPageHref(resource.activity_type, resource.field, resource.value)}
            >
              Manage
            </a>
          )}
        </div>
      </header>
      <p class="activity-type-item-subtitle">
        {resource.activity_type_name}
        {resource.value && resource.value !== name && ` · ${resource.value}`}
      </p>

      {history.length === 0 ? (
        <p class="activity-type-item-empty">No sessions yet.</p>
      ) : (
        <>
          <div class="activity-type-item-cards">
            {records.map((r) => (
              <RecordCard key={r.measure} record={r} />
            ))}
            {done && <DoneCard done={done} />}
          </div>

          <ExerciseChart perWeek={perWeek} trend={trend} />

          <section class="activity-type-item-section">
            <h2>History</h2>
            <ItemSessionsTable sessions={history} />
          </section>
        </>
      )}
    </div>
  )
}
