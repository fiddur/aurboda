import { MuscleRecoveryList } from '../../components/muscleRecovery/MuscleRecoveryList'
import { useMuscleRecovery } from '../../components/muscleRecovery/useMuscleRecovery'
import { SETS_PATH, STRENGTH_TYPE } from './constants'

export const MuscleRecoveryCard = () => {
  const { data } = useMuscleRecovery(STRENGTH_TYPE, SETS_PATH)
  if (!data) return null
  return (
    <section class="strength-card">
      <h2>Muscle recovery</h2>
      <MuscleRecoveryList name={STRENGTH_TYPE} notReadyOnly path={SETS_PATH} recovery={data} />
    </section>
  )
}
