import type { PublicSharedExerciseResponse, SharedExerciseData } from '@aurboda/api-spec'

import { AttributionLink } from '../../components/AttributionLink'
import { exerciseChartTitle } from '../../components/charts/exercise-chart'
import { ExerciseChart } from '../../components/charts/ExerciseChart'
import { RecordCard } from '../../components/RecordCard'
import { itemPageHref } from '../../components/sessions/sessionView'
import { CopyLinkButton, NativeShareButton } from '../../components/ShareControls'
import { DoneCard } from '../ActivityTypeItem/ItemCards'
import { ItemSessionsTable } from '../ActivityTypeItem/ItemSessionsTable'
import '../ActivityTypeItem/style.css'
import './style.css'

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
  const chartTitle = exerciseChartTitle(perWeek, trend)

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

          {chartTitle && (
            <section class="activity-type-item-section">
              <h2>{chartTitle}</h2>
              <ExerciseChart perWeek={perWeek} trend={trend} />
            </section>
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
