import { MuscleGroupSection } from '../ActivityTypeMeta/MuscleGroupSection'
import { MuscleRecoverySection } from '../ActivityTypeMeta/MuscleRecoverySection'
import { unmappedSectionId } from '../ActivityTypeMeta/UnmappedItemValuesSection'
import { SETS_PATH, STRENGTH_TYPE } from './constants'
import { StrengthTabs } from './StrengthTabs'
import '../ActivityTypeMeta/style.css'
import './style.css'

export function StrengthMuscles() {
  return (
    <div class="page page--wide strength-page strength-page-wide">
      <h1>Strength</h1>
      <StrengthTabs />
      <MuscleRecoverySection name={STRENGTH_TYPE} path={SETS_PATH} />
      <MuscleGroupSection
        name={STRENGTH_TYPE}
        path={SETS_PATH}
        unmappedHref={`/activity-type/${STRENGTH_TYPE}#${unmappedSectionId(SETS_PATH)}`}
      />
    </div>
  )
}
