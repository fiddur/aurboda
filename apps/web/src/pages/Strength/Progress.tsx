import { StrengthScoreContent } from '../StrengthScore/index'
import { SETS_PATH, STRENGTH_TYPE } from './constants'
import { StrengthTabs } from './StrengthTabs'
import './style.css'

export function StrengthProgress() {
  return (
    <div class="strength-page strength-page-wide">
      <h1>Strength</h1>
      <StrengthTabs />
      <p class="strength-muted">Best lifts of the last 90 days</p>
      <StrengthScoreContent field={SETS_PATH} name={STRENGTH_TYPE} />
    </div>
  )
}
