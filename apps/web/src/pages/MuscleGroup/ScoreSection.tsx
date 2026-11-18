import { type ExerciseMuscleGroup, exerciseMuscleInfo } from '@aurboda/api-spec'
import { useMemo } from 'preact/hooks'

import { TrendLineChart } from '../../components/charts/TrendLineChart'
import { strengthScoreHref } from '../../components/sessions/sessionView'
import { CHART_PRIMARY } from '../../theme'
import { useStrengthScore, useStrengthScoreHistory } from '../StrengthScore/queries'
import { scoreGroupOf, scoreSeries } from '../StrengthScore/strengthScoreView'
import { scoreSectionHeading } from './muscleGroupView'

export const ScoreSection = ({
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
  const scoreGroup = scoreGroupOf(group, useStrengthScore(name, field).data)
  const history = useStrengthScoreHistory(name, field, periodDays)
  const series = useMemo(
    () => (scoreGroup ? scoreSeries(history.data, scoreGroup.group) : []),
    [history.data, scoreGroup],
  )
  if (!scoreGroup || series.length < 2) return null
  return (
    <section class="activity-type-item-section">
      <h2>{scoreSectionHeading(scoreGroup.name, exerciseMuscleInfo[group].name)}</h2>
      <TrendLineChart data={series} color={CHART_PRIMARY} height={180} />
      <p class="activity-type-item-caption">
        Each point is the score from the best sets of the 90 days before it.{' '}
        <a href={strengthScoreHref(name, field)}>All lifts</a>
      </p>
    </section>
  )
}
