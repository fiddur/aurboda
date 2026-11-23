import { useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useState } from 'preact/hooks'

import { detailUrl, sessionUrl, STRENGTH_TYPE } from './constants'
import { clearLiveDraft } from './draftStorage'
import { PlannedWorkouts } from './PlannedWorkouts'
import { invalidateStrengthQueries, liveApi, useUnfinishedSession } from './queries'
import { finishLiveSession } from './saveQueue'
import { type SessionDraft, sessionSummary } from './sessionModel'
import {
  exerciseListLabel,
  lastSetLabel,
  repeatCandidates,
  sessionDateLabel,
  startedLabel,
} from './startModel'
import { StrengthHeader } from './StrengthHeader'
import './style.css'

const UnfinishedCard = ({
  draft,
  finishing,
  error,
  onFinish,
}: {
  draft: SessionDraft
  finishing: boolean
  error?: string
  onFinish: () => void
}) => {
  const now = new Date()
  return (
    <section class="strength-card strength-unfinished">
      <h2>Unfinished session</h2>
      <p>{startedLabel(new Date(draft.start_time), now)}</p>
      <p class="strength-muted">
        {sessionSummary(draft.blocks)}. {lastSetLabel(draft.last_set_at, now) ?? ''}
      </p>
      {error && <p class="strength-error">{error}</p>}
      <div class="strength-row-actions">
        <a class="btn-primary" href={draft.id ? sessionUrl(draft.id) : '/strength/live'}>
          Continue
        </a>
        <button type="button" class="btn-secondary" onClick={onFinish} disabled={finishing}>
          {finishing ? 'Finishing…' : 'Finish it'}
        </button>
      </div>
    </section>
  )
}

export function StrengthWorkouts() {
  const queryClient = useQueryClient()
  const { route } = useLocation()
  const { local, sessions, setLocal, unfinished } = useUnfinishedSession()
  const [finishing, setFinishing] = useState(false)
  const [finishError, setFinishError] = useState<string | undefined>()
  const [confirmTarget, setConfirmTarget] = useState<string | undefined>()

  const candidates = repeatCandidates(sessions.data ?? [], unfinished?.id)

  const finish = async (): Promise<boolean> => {
    if (!unfinished) return true
    setFinishing(true)
    setFinishError(undefined)
    try {
      await finishLiveSession(unfinished, liveApi, unfinished.last_set_at ?? unfinished.start_time)
      if (!local?.id || local.id === unfinished.id) clearLiveDraft()
      setLocal(undefined)
      await invalidateStrengthQueries(queryClient)
      return true
    } catch {
      setFinishError('The session could not be finished. Try again.')
      return false
    } finally {
      setFinishing(false)
    }
  }

  const start = (url: string) => {
    if (unfinished) setConfirmTarget(url)
    else route(url)
  }

  return (
    <div class="page page--wide strength-page strength-page-train">
      <StrengthHeader />
      {unfinished && (
        <UnfinishedCard
          draft={unfinished}
          finishing={finishing}
          error={finishError}
          onFinish={() => void finish()}
        />
      )}
      {confirmTarget && unfinished ? (
        <div class="strength-card strength-confirm" role="alert">
          <p>Finish the unfinished session before starting a new one?</p>
          <div class="strength-row-actions">
            <button
              type="button"
              class="btn-primary"
              disabled={finishing}
              onClick={async () => {
                if (await finish()) route(confirmTarget)
              }}
            >
              Finish it and start
            </button>
            <button type="button" class="btn-secondary" onClick={() => setConfirmTarget(undefined)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div class="strength-start-actions">
          <button type="button" class="btn-primary strength-wide-btn" onClick={() => start('/strength/live')}>
            Start a session now
          </button>
          <a class="btn-secondary strength-wide-btn" href="/strength/log">
            Log a past session
          </a>
        </div>
      )}
      <PlannedWorkouts onStart={start} />
      <section class="strength-section">
        <h2>Repeat a session</h2>
        {sessions.isLoading && <p class="loading">Loading…</p>}
        {sessions.isError && <p class="strength-error">Your recent sessions could not be loaded.</p>}
        {!sessions.isLoading && !sessions.isError && candidates.length === 0 && (
          <p class="strength-muted">No sessions with sets in the last 90 days.</p>
        )}
        <ul class="strength-repeat-list">
          {candidates.map((c) => (
            <li key={c.id} class="strength-card strength-repeat">
              <div class="strength-repeat-text">
                <a href={detailUrl(c.id)}>{sessionDateLabel(c.start_time, c.minutes)}</a>
                <span class="strength-muted">{exerciseListLabel(c.names)}</span>
              </div>
              <button
                type="button"
                class="btn-secondary"
                onClick={() => start(`/strength/live?repeat=${encodeURIComponent(c.id)}`)}
              >
                Repeat
              </button>
            </li>
          ))}
        </ul>
      </section>
      <p>
        <a href={`/activity-type/${STRENGTH_TYPE}`}>All strength sessions</a>
      </p>
    </div>
  )
}
