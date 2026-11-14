import { useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useState } from 'preact/hooks'

import { sessionUrl, STRENGTH_TYPE } from './constants'
import { clearLiveDraft, readLiveDraft } from './draftStorage'
import { invalidateStrengthQueries, liveApi, useRecentStrengthSessions } from './queries'
import { finishLiveSession } from './saveQueue'
import { liveDraftFromServer, loggedSetCount, type SessionDraft, sessionSummary } from './sessionModel'
import {
  exerciseListLabel,
  lastSetLabel,
  repeatCandidates,
  sessionDateLabel,
  startedLabel,
  type StrengthActivity,
  unfinishedOnServer,
} from './startModel'
import './style.css'

const unfinishedDraft = (
  local: SessionDraft | undefined,
  server: StrengthActivity | undefined,
): SessionDraft | undefined => {
  if (local && !local.id && loggedSetCount(local.blocks) > 0) return local
  if (!server?.id) return undefined
  if (local?.id === server.id) return local
  return liveDraftFromServer({
    data: server.data,
    id: server.id,
    start_time: server.start_time.toISOString(),
  })
}

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

export function Strength() {
  const queryClient = useQueryClient()
  const { route } = useLocation()
  const [local, setLocal] = useState(() => readLiveDraft())
  const sessions = useRecentStrengthSessions()
  const [finishing, setFinishing] = useState(false)
  const [finishError, setFinishError] = useState<string | undefined>()
  const [confirmTarget, setConfirmTarget] = useState<string | undefined>()

  const rows = sessions.data ?? []
  const unfinished = unfinishedDraft(local, unfinishedOnServer(rows, new Date()))
  const candidates = repeatCandidates(rows, unfinished?.id)

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
    <div class="strength-page">
      <h1>Strength training</h1>
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
                <span>{sessionDateLabel(c.start_time, c.minutes)}</span>
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
      <a href={`/activity-type/${STRENGTH_TYPE}`}>All strength sessions</a>
    </div>
  )
}
