import { MuscleRecoveryList } from '../../components/muscleRecovery/MuscleRecoveryList'
import { useMuscleRecovery } from '../../components/muscleRecovery/useMuscleRecovery'

export function MuscleRecoverySection({ name, path }: { name: string; path: string }) {
  const { data } = useMuscleRecovery(name, path)
  if (!data) return null
  return (
    <section class="activity-type-meta-section">
      <h2>Muscle recovery</h2>
      <MuscleRecoveryList name={name} path={path} recovery={data} />
      <p class="activity-type-meta-strength-score-muted">
        From the strength sets of the last 10 days: each set tires the muscles it works, and the fatigue
        halves every 24 to 36 hours.
      </p>
    </section>
  )
}
