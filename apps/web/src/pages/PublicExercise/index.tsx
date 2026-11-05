import type { PublicSharedExerciseResponse, SharedExerciseData } from '@aurboda/api-spec'

import { activityMeasureLabels } from '@aurboda/api-spec'
import { useMemo } from 'preact/hooks'

import { AttributionLink } from '../../components/AttributionLink'
import { BarChart } from '../../components/charts/BarChart'
import { TrendLineChart } from '../../components/charts/TrendLineChart'
import { ShareLinkButton } from '../../components/ShareLinkButton'
import { DoneCard, RecordCard } from '../ActivityTypeItem/ItemCards'
import { ItemSessionsTable } from '../ActivityTypeItem/ItemSessionsTable'
import '../ActivityTypeItem/style.css'

/** One shared exercise, read-only, from the server-resolved projection of its sessions. */
export function PublicExercise({
  data,
  resource,
  username,
}: {
  data: SharedExerciseData
  resource: PublicSharedExerciseResponse
  username: string
}) {
  const name = resource.name ?? resource.value ?? 'Exercise'
  const { done, history, per_week: perWeek, records, trend } = data
  const line = useMemo(
    () => (trend && perWeek && trend.measure === perWeek.measure ? { data: trend.history } : undefined),
    [trend, perWeek],
  )

  return (
    <div class="public-dashboard">
      <div class="dashboard-header">
        <h1>{name}</h1>
        <AttributionLink username={username} />
        <ShareLinkButton url={window.location.href} title={`${name} — Aurboda`} />
      </div>
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

          {perWeek ? (
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
                {line
                  ? `${activityMeasureLabels[perWeek.measure]} of each week; the line is the decaying best, with a ${trend?.half_life_days}-day half-life between sessions.`
                  : `${activityMeasureLabels[perWeek.measure]}, ${perWeek.aggregation === 'max' ? 'the best' : 'the total'} of each week.`}
              </p>
            </section>
          ) : (
            trend && (
              <section class="activity-type-item-section">
                <h2>Trend</h2>
                <TrendLineChart data={trend.history} color="#8b5cf6" height={220} />
                <p class="activity-type-item-caption">
                  {activityMeasureLabels[trend.measure]}, decaying with a {trend.half_life_days}-day half-life
                  between sessions.
                </p>
              </section>
            )
          )}

          <section class="activity-type-item-section">
            <h2>History</h2>
            <ItemSessionsTable sessions={history} />
          </section>
        </>
      )}
    </div>
  )
}
