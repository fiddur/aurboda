import { useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useState } from 'preact/hooks'

import { useMuscleRecovery } from '../../components/muscleRecovery/useMuscleRecovery'
import { SETS_PATH, STRENGTH_TYPE, summaryUrl } from './constants'
import { clearLiveDraft } from './draftStorage'
import { NoPlans, PlannedWorkouts } from './PlannedWorkouts'
import { invalidateStrengthQueries, liveApi, useOpenStrengthPlans, useUnfinishedSession } from './queries'
import { RecentSessions } from './RecentSessions'
import { discardLiveSession, finishLiveSession } from './saveQueue'
import { repeatCandidates, type UnfinishedAction, unfinishedAction } from './startModel'
import { StrengthHeader } from './StrengthHeader'
import { UnfinishedCard } from './UnfinishedCard'
import './style.css'

export function StrengthWorkouts() {
  const queryClient = useQueryClient()
  const { route } = useLocation()
  const { local, sessions, setLocal, unfinished } = useUnfinishedSession()
  const [busy, setBusy] = useState<UnfinishedAction | undefined>()
  const [closeError, setCloseError] = useState<string | undefined>()
  const [confirmTarget, setConfirmTarget] = useState<string | undefined>()

  const plans = useOpenStrengthPlans()
  const recovery = useMuscleRecovery(STRENGTH_TYPE, SETS_PATH)
  const openPlans = plans.data ?? []
  const candidates = repeatCandidates(sessions.data ?? [], unfinished?.id)

  const close = async (action: UnfinishedAction): Promise<{ id?: string } | undefined> => {
    if (!unfinished) return {}
    setBusy(action)
    setCloseError(undefined)
    try {
      let id: string | undefined
      if (action === 'finish') {
        id = await finishLiveSession(unfinished, liveApi, unfinished.last_set_at ?? unfinished.start_time)
      } else {
        await discardLiveSession(unfinished, liveApi)
      }
      if (!local?.id || local.id === unfinished.id) clearLiveDraft()
      setLocal(undefined)
      await invalidateStrengthQueries(queryClient)
      return { id }
    } catch {
      setCloseError(
        action === 'finish'
          ? 'The session could not be finished. Try again.'
          : 'The session could not be discarded. Try again.',
      )
      return undefined
    } finally {
      setBusy(undefined)
    }
  }

  const discard = () => {
    if (window.confirm('Discard this session? Its sets are deleted.')) void close('discard')
  }

  const startAction = unfinished ? unfinishedAction(unfinished) : 'finish'

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
          busy={busy}
          error={closeError}
          onFinish={async () => {
            const id = (await close('finish'))?.id
            if (id) route(summaryUrl(id))
          }}
          onDiscard={discard}
        />
      )}
      {confirmTarget && unfinished ? (
        <div class="strength-card strength-confirm" role="alert">
          <p>
            {startAction === 'finish'
              ? 'Finish the unfinished session before starting a new one?'
              : 'The unfinished session has no logged set. Discard it before starting a new one?'}
          </p>
          <div class="strength-row-actions">
            <button
              type="button"
              class="btn-primary"
              disabled={busy !== undefined}
              onClick={async () => {
                if (await close(startAction)) route(confirmTarget)
              }}
            >
              {startAction === 'finish' ? 'Finish it and start' : 'Discard it and start'}
            </button>
            <button type="button" class="btn-secondary" onClick={() => setConfirmTarget(undefined)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        !plans.isLoading &&
        openPlans.length === 0 && (
          <div class="strength-start-actions">
            <button
              type="button"
              class="btn-primary strength-wide-btn"
              onClick={() => start('/strength/live')}
            >
              Start an empty session
            </button>
            <a class="btn-secondary strength-wide-btn" href="/strength/log">
              Log a past session
            </a>
          </div>
        )
      )}
      {openPlans.length > 0 ? (
        <PlannedWorkouts plans={openPlans} recovery={recovery.data} onStart={start} />
      ) : (
        <NoPlans state={plans.isError ? 'error' : plans.data ? 'empty' : 'loading'} />
      )}
      <RecentSessions
        candidates={candidates}
        isError={sessions.isError}
        isLoading={sessions.isLoading}
        plans={openPlans}
        onStart={start}
      />
      <p>
        <a href={`/activity-type/${STRENGTH_TYPE}`}>All strength sessions</a>
      </p>
    </div>
  )
}
