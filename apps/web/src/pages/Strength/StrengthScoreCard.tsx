import { strengthScoreHref } from '../../components/sessions/sessionView'
import { useStrengthScore } from '../StrengthScore/queries'
import { groupScoresLine } from '../StrengthScore/strengthScoreView'
import { SETS_PATH, STRENGTH_TYPE } from './constants'

export const StrengthScoreCard = () => {
  const { data } = useStrengthScore(STRENGTH_TYPE, SETS_PATH)
  if (!data || data.score === null) return null
  return (
    <a class="strength-card strength-score-card" href={strengthScoreHref(STRENGTH_TYPE, SETS_PATH)}>
      <span class="strength-muted">Strength score</span>
      <span class="strength-score-card-value">{data.score}</span>
      <span class="strength-muted">{groupScoresLine(data)}</span>
    </a>
  )
}
