import { type StrengthScore, strengthScoreMetricOf } from '@aurboda/api-spec'

import {
  MissingNotice,
  ScoreCaption,
  ScoreCards,
  scoreGroupNames,
  StrengthScoreLoader,
} from '../StrengthScore/index'
import { useStrengthScoreHistory } from '../StrengthScore/queries'
import { ScoreHistory } from '../StrengthScore/ScoreHistory'
import { STRENGTH_SCORE_PERIODS } from '../StrengthScore/strengthScoreView'
import { SETS_PATH, STRENGTH_TYPE } from './constants'
import { LeavingSection, MovedSection, SetsPerWeekSection } from './ProgressSections'
import { StrengthHeader } from './StrengthHeader'
import './style.css'

const Scored = ({ score }: { score: StrengthScore }) => {
  const history = useStrengthScoreHistory(STRENGTH_TYPE, SETS_PATH, STRENGTH_SCORE_PERIODS[0].value)
  return (
    <>
      <ScoreCards field={SETS_PATH} name={STRENGTH_TYPE} score={score} />
      <ScoreHistory
        field={SETS_PATH}
        groupNames={scoreGroupNames(score)}
        metricOf={strengthScoreMetricOf}
        name={STRENGTH_TYPE}
      />
      {history.isSuccess && history.data && <MovedSection history={history.data} score={score} />}
      <LeavingSection field={SETS_PATH} name={STRENGTH_TYPE} score={score} />
    </>
  )
}

export function StrengthProgress() {
  return (
    <div class="page page--wide strength-page strength-page-wide">
      <StrengthHeader />
      <p class="strength-muted">Best lifts of the last 90 days</p>
      <StrengthScoreLoader field={SETS_PATH} name={STRENGTH_TYPE}>
        {(score) => (
          <>
            <MissingNotice missing={score.missing} />
            {score.missing.length === 0 && <Scored score={score} />}
            <SetsPerWeekSection name={STRENGTH_TYPE} path={SETS_PATH} />
            <ScoreCaption field={SETS_PATH} name={STRENGTH_TYPE} />
          </>
        )}
      </StrengthScoreLoader>
    </div>
  )
}
