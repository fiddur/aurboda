import type { StrengthPlan } from '@aurboda/api-spec'

import { detailUrl } from './constants'
import { savedAsPlan } from './planModel'
import { exerciseListLabel, type RepeatCandidate, sessionDateLabel } from './startModel'

export const RecentSessions = ({
  candidates,
  isError,
  isLoading,
  plans,
  onStart,
}: {
  candidates: RepeatCandidate[]
  isError: boolean
  isLoading: boolean
  plans: StrengthPlan[]
  onStart: (url: string) => void
}) => (
  <section class="strength-section">
    <h2>Recent sessions</h2>
    {isLoading && <p class="loading">Loading…</p>}
    {isError && <p class="strength-error">Your recent sessions could not be loaded.</p>}
    {!isLoading && !isError && candidates.length === 0 && (
      <p class="strength-muted">No sessions with sets in the last 90 days.</p>
    )}
    <ul class="strength-repeat-list">
      {candidates.map((c) => {
        const saved = savedAsPlan(c.plan_id, plans)
        return (
          <li key={c.id} class="strength-card strength-repeat">
            <div class="strength-repeat-text">
              <a href={detailUrl(c.id)}>{sessionDateLabel(c.start_time, c.minutes)}</a>
              <span class="strength-muted">{exerciseListLabel(c.names)}</span>
            </div>
            <div class="strength-row-actions strength-repeat-actions">
              {saved ? (
                <span class="strength-muted">Saved as {saved.name}</span>
              ) : (
                <a class="btn-secondary" href={`/strength/plan/new?from=${encodeURIComponent(c.id)}`}>
                  Save as a workout
                </a>
              )}
              <button
                type="button"
                class="btn-secondary"
                onClick={() => onStart(`/strength/live?repeat=${encodeURIComponent(c.id)}`)}
              >
                Repeat
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  </section>
)
