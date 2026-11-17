import type { MuscleRecovery } from '@aurboda/api-spec'

import { muscleGroupHref } from '../sessions/sessionView'
import { readyLabel, recoveryLevel, restCount, restLine, tiredGroups } from './recoveryView'
import './muscleRecovery.css'

export const MuscleRecoveryList = ({
  name,
  notReadyOnly = false,
  path,
  recovery,
}: {
  name: string
  notReadyOnly?: boolean
  path: string
  recovery: MuscleRecovery
}) => {
  const now = new Date()
  const below = notReadyOnly ? recovery.ready_percent : 100
  const tired = tiredGroups(recovery, below)
  const rest = restLine(restCount(recovery, below), tired.length, notReadyOnly ? 'ready' : 'recovered')
  return (
    <div class="muscle-recovery">
      {tired.length > 0 && (
        <ul class="muscle-recovery-list">
          {tired.map((g) => (
            <li
              key={g.muscle_group}
              class={`muscle-recovery-row muscle-recovery-${recoveryLevel(g.recovery, recovery.ready_percent)}`}
            >
              <a class="muscle-recovery-name" href={muscleGroupHref(name, path, g.muscle_group)}>
                {g.name}
              </a>
              <span class="muscle-recovery-percent">{g.recovery} %</span>
              <span
                class="muscle-recovery-bar"
                role="meter"
                aria-label={`${g.name} recovery`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={g.recovery}
              >
                <span class="muscle-recovery-fill" style={{ width: `${g.recovery}%` }} />
              </span>
              <span class="muscle-recovery-when">{readyLabel(g.ready_at, now)}</span>
            </li>
          ))}
        </ul>
      )}
      {rest && <p class="muscle-recovery-muted">{rest}</p>}
    </div>
  )
}
