import { StrengthScoreContent } from '../StrengthScore/index'
import { SETS_PATH, STRENGTH_TYPE } from './constants'
import { StrengthHeader } from './StrengthHeader'
import './style.css'

export function StrengthProgress() {
  return (
    <div class="page page--wide strength-page strength-page-wide">
      <StrengthHeader />
      <p class="strength-muted">Best lifts of the last 90 days</p>
      <StrengthScoreContent field={SETS_PATH} name={STRENGTH_TYPE} withoutGroups />
    </div>
  )
}
