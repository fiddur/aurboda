import type { ExerciseMuscleGroup } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { Fragment } from 'preact'
import { useMemo } from 'preact/hooks'

import { TrendLineChart } from '../../components/charts/TrendLineChart'
import {
  recoveryOf,
  recoveryPeriod,
  recoverySeries,
  sourceLabel,
} from '../../components/muscleRecovery/recoveryView'
import { useMuscleRecovery } from '../../components/muscleRecovery/useMuscleRecovery'
import { fetchMuscleRecoveryHistory } from '../../state/api'
import { CHART_PRIMARY } from '../../theme'

const useMuscleRecoveryHistory = (name: string, field: string) => {
  const period = useMemo(() => recoveryPeriod(new Date()), [])
  return useQuery({
    queryFn: () => fetchMuscleRecoveryHistory(name, { field, ...period }),
    queryKey: ['muscle-recovery-history', name, field, period.start, period.end, period.step_hours],
    staleTime: 5 * 60 * 1000,
  })
}

export const RecoverySection = ({
  field,
  group,
  name,
}: {
  field: string
  group: ExerciseMuscleGroup
  name: string
}) => {
  const current = recoveryOf(useMuscleRecovery(name, field).data, group)
  const history = useMuscleRecoveryHistory(name, field)
  const series = useMemo(() => recoverySeries(history.data, group), [history.data, group])
  const sources = current?.sources ?? []
  if (sources.length === 0 && !series.some((p) => p.value < 100)) return null
  return (
    <section class="activity-type-item-section">
      <h2>Recovery</h2>
      {series.length >= 2 && <TrendLineChart data={series} color={CHART_PRIMARY} height={180} />}
      {sources.length > 0 && (
        <p class="muscle-group-recovery-sources">
          Still tired from:{' '}
          {sources.map((s, i) => (
            <Fragment key={s.session_id}>
              {i > 0 && ', '}
              <a href={`/detail/activity/${s.session_id}`}>{sourceLabel(s)}</a>
            </Fragment>
          ))}
        </p>
      )}
      <p class="activity-type-item-caption">
        A model from your logged strength sets, not a measurement: it does not know about other training,
        sleep or soreness.
      </p>
    </section>
  )
}
