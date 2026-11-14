import type { ActivityItemHistory } from '@aurboda/api-spec'

import { useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useLocation } from 'preact-iso'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'

import { formatMeasure } from '../../utils/measures'
import { detailUrl, sessionUrl } from './constants'
import {
  clearLiveDraft,
  readNumberPref,
  REST_LENGTH_KEY,
  WEIGHT_STEP_KEY,
  writeLiveDraft,
  writeNumberPref,
} from './draftStorage'
import { CollapsedBlock, ExerciseBlockCard } from './ExerciseBlockCard'
import { ExercisePicker } from './ExercisePicker'
import { DEFAULT_WEIGHT_STEP, WEIGHT_STEPS } from './formModel'
import {
  groupFor,
  invalidateStrengthQueries,
  liveApi,
  useExerciseContext,
  useSessionHistory,
} from './queries'
import { recordLines } from './records'
import { RestBar } from './RestBar'
import {
  DEFAULT_REST_S,
  elapsedSeconds,
  extendRest,
  formatClock,
  REST_LENGTHS_S,
  type RestAdjust,
  restState,
  skipRest,
} from './restTimer'
import { createSaveQueue, finishLiveSession, type SaveStatus, saveLiveSession } from './saveQueue'
import {
  addBlock,
  blockSummary,
  clearSavedExerciseKeys,
  deleteSet,
  type ExerciseBlock,
  isDirty,
  isTimedBlock,
  loggedSetCount,
  logSet,
  moveBlock,
  nextSetPrefill,
  removeBlock,
  type SessionDraft,
  setLabel,
  setsOfExercise,
  supersetBlockIds,
  updateSet,
} from './sessionModel'
import { SetForm } from './SetForm'

const STATUS_TEXT: Record<SaveStatus, string> = {
  failed: 'not saved yet, will retry',
  idle: 'not saved yet',
  saved: 'saved',
  saving: 'saving…',
}

const VIBRATE_MS = 300

const useNow = (ms: number): number => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [ms])
  return now
}

const useWakeLock = () => {
  useEffect(() => {
    const wakeLock = (
      navigator as Navigator & {
        wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> }
      }
    ).wakeLock
    if (!wakeLock) return
    let sentinel: { release: () => Promise<void> } | undefined
    let active = true
    const request = () => {
      if (document.visibilityState !== 'visible') return
      wakeLock
        .request('screen')
        .then((s) => {
          if (active) sentinel = s
          else void s.release().catch(() => undefined)
        })
        .catch(() => undefined)
    }
    request()
    document.addEventListener('visibilitychange', request)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', request)
      void sentinel?.release().catch(() => undefined)
    }
  }, [])
}

const CurrentBlock = ({
  block,
  draft,
  history,
  superset,
  weightStep,
  onWeightStepChange,
  onChange,
}: {
  block: ExerciseBlock
  draft: SessionDraft
  history: ActivityItemHistory | undefined
  superset: boolean
  weightStep: number
  onWeightStepChange: (step: number) => void
  onChange: (fn: (blocks: ExerciseBlock[]) => ExerciseBlock[], opts?: { logged?: boolean }) => void
}) => {
  const group = block.sets.length > 0 ? groupFor(history, block.exercise) : undefined
  const ctx = useExerciseContext(block.exercise, group, draft.id)
  const lastItems = ctx.lastTime?.items ?? []
  const timed = isTimedBlock(block, lastItems)
  const index = draft.blocks.findIndex((b) => b.id === block.id)
  const info = [
    ...(ctx.lastTime
      ? [
          `Last time, ${format(new Date(ctx.lastTime.start_time), 'EEE d MMM')}: ${lastItems.map(setLabel).join(', ')}`,
        ]
      : []),
    ...(ctx.bestE1rm !== undefined ? [`Best e1RM ${formatMeasure('e1rm', ctx.bestE1rm)}`] : []),
  ]
  const records =
    group?.previous && group.records.length > 0
      ? recordLines(group.records, group.measures, setsOfExercise(draft.blocks, block.exercise))
      : undefined
  const setNumber = block.sets.length + 1

  return (
    <ExerciseBlockCard
      block={block}
      position={index}
      count={draft.blocks.length}
      muscles={ctx.muscles}
      superset={superset}
      info={info}
      records={records}
      timed={timed}
      weightStep={weightStep}
      onUpdateSet={(i, set) => onChange((blocks) => updateSet(blocks, block.id, i, set))}
      onDeleteSet={(i) => onChange((blocks) => deleteSet(blocks, block.id, i))}
      onRemove={() => onChange((blocks) => removeBlock(blocks, block.id))}
      onMove={(delta) => onChange((blocks) => moveBlock(blocks, block.id, delta))}
    >
      <div class="strength-next-set">
        <h3>Set {setNumber}</h3>
        <SetForm
          key={`${block.id}-${block.sets.length}-${ctx.lastTime ? 'last' : 'none'}`}
          idPrefix={`${block.id}-next`}
          initial={nextSetPrefill(block, lastItems)}
          timed={timed}
          submitLabel={`Log set ${setNumber}`}
          weightStep={weightStep}
          onWeightStepChange={onWeightStepChange}
          onSubmit={(set) => onChange((blocks) => logSet(blocks, block.id, set), { logged: true })}
        />
      </div>
    </ExerciseBlockCard>
  )
}

export const LiveSession = ({ initial, onId }: { initial: SessionDraft; onId: (id: string) => void }) => {
  const queryClient = useQueryClient()
  const { route } = useLocation()
  const [draft, setDraft] = useState(initial)
  const draftRef = useRef(initial)
  const [status, setStatus] = useState<SaveStatus>(initial.id && !isDirty(initial) ? 'saved' : 'idle')
  const [picking, setPicking] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [finishError, setFinishError] = useState<string | undefined>()
  const finishingRef = useRef(false)
  const [weightStep, setWeightStep] = useState(() =>
    readNumberPref(WEIGHT_STEP_KEY, DEFAULT_WEIGHT_STEP, WEIGHT_STEPS),
  )
  const [restLength, setRestLength] = useState(() =>
    readNumberPref(REST_LENGTH_KEY, DEFAULT_REST_S, REST_LENGTHS_S),
  )
  const [restAdjust, setRestAdjust] = useState<RestAdjust | undefined>()
  const now = useNow(1000)
  const history = useSessionHistory(draft.id)
  useWakeLock()

  const navigation = useRef({ onId, route })
  navigation.current = { onId, route }

  const store = useCallback((next: SessionDraft) => {
    draftRef.current = next
    setDraft(next)
    writeLiveDraft(next)
  }, [])

  const queue = useMemo(
    () =>
      createSaveQueue({
        clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
        onStatus: setStatus,
        save: async () => {
          if (finishingRef.current) return
          const snapshot = draftRef.current
          const id = await saveLiveSession(snapshot, liveApi, () =>
            store({ ...draftRef.current, create_attempted: true }),
          )
          const current = draftRef.current
          store({
            ...current,
            blocks: clearSavedExerciseKeys(current.blocks, snapshot.blocks),
            id,
            saved_rev: Math.max(current.saved_rev, snapshot.rev),
          })
          if (!snapshot.id) {
            navigation.current.onId(id)
            navigation.current.route(sessionUrl(id), true)
          }
          void queryClient.invalidateQueries({ queryKey: ['activity-item-history', id] })
        },
        setTimer: (fn, ms) => setTimeout(fn, ms),
      }),
    [store, queryClient],
  )

  useEffect(() => {
    const retry = () => void queue.retry()
    const onVisible = () => {
      if (document.visibilityState === 'visible') retry()
    }
    window.addEventListener('online', retry)
    document.addEventListener('visibilitychange', onVisible)
    if (isDirty(draftRef.current) && (draftRef.current.id || loggedSetCount(draftRef.current.blocks) > 0)) {
      void queue.request()
    }
    return () => {
      window.removeEventListener('online', retry)
      document.removeEventListener('visibilitychange', onVisible)
      queue.dispose()
    }
  }, [queue])

  const change = useCallback(
    (fn: (d: SessionDraft) => SessionDraft, saves = true) => {
      const next = fn(draftRef.current)
      store(saves ? { ...next, rev: next.rev + 1 } : next)
      if (saves && (next.id || loggedSetCount(next.blocks) > 0)) void queue.request()
    },
    [store, queue],
  )

  const changeBlocks = (fn: (blocks: ExerciseBlock[]) => ExerciseBlock[], opts?: { logged?: boolean }) =>
    change((d) => ({
      ...d,
      blocks: fn(d.blocks),
      ...(opts?.logged ? { last_set_at: new Date().toISOString() } : {}),
    }))

  const lastSetAt = draft.last_set_at
  const rest = finishing ? undefined : restState(lastSetAt, restLength, now, restAdjust)
  const resting = rest !== undefined
  const wasResting = useRef(resting)
  useEffect(() => {
    const skipped = restAdjust?.skipped && restAdjust.for_set_at === draft.last_set_at
    if (wasResting.current && !resting && !skipped && !finishing) navigator.vibrate?.(VIBRATE_MS)
    wasResting.current = resting
  }, [resting, restAdjust, draft.last_set_at, finishing])

  const finish = async () => {
    setFinishing(true)
    setFinishError(undefined)
    finishingRef.current = true
    try {
      await queue.whenIdle()
      const id = await finishLiveSession(draftRef.current, liveApi, new Date().toISOString())
      queue.dispose()
      clearLiveDraft()
      await invalidateStrengthQueries(queryClient)
      route(id ? detailUrl(id) : '/strength')
    } catch {
      finishingRef.current = false
      setFinishing(false)
      setFinishError('The session could not be finished. Your sets are kept on this device; try again.')
      if (isDirty(draftRef.current)) void queue.request()
    }
  }

  const currentId = draft.blocks.some((b) => b.id === draft.current_block_id)
    ? draft.current_block_id
    : draft.blocks.at(-1)?.id
  const supersets = supersetBlockIds(draft.blocks)
  const started = new Date(draft.start_time)
  const statusText = finishing
    ? 'finishing…'
    : loggedSetCount(draft.blocks) === 0 && !draft.id
      ? 'no set logged yet'
      : STATUS_TEXT[status]

  return (
    <div class="strength-page">
      <header class="strength-sticky-header">
        <div>
          <h1>Session</h1>
          <p class="strength-muted" aria-live="polite">
            {formatClock(elapsedSeconds(draft.start_time, now))} since {format(started, 'HH:mm')},{' '}
            {statusText}
          </p>
        </div>
        <button type="button" class="btn-primary" onClick={() => void finish()} disabled={finishing}>
          Finish
        </button>
      </header>
      {finishError && <p class="strength-error">{finishError}</p>}
      {rest && lastSetAt && (
        <RestBar
          rest={rest}
          lengthS={restLength}
          onLengthChange={(s) => {
            setRestLength(s)
            writeNumberPref(REST_LENGTH_KEY, s)
          }}
          onExtend={() => setRestAdjust((a) => extendRest(lastSetAt, a))}
          onSkip={() => setRestAdjust(skipRest(lastSetAt))}
        />
      )}
      {draft.blocks.length === 0 && (
        <p class="strength-muted">Add the first exercise to start logging sets.</p>
      )}
      {draft.blocks.map((block) =>
        block.id === currentId ? (
          <CurrentBlock
            key={block.id}
            block={block}
            draft={draft}
            history={history.data}
            superset={supersets.has(block.id)}
            weightStep={weightStep}
            onWeightStepChange={(s) => {
              setWeightStep(s)
              writeNumberPref(WEIGHT_STEP_KEY, s)
            }}
            onChange={changeBlocks}
          />
        ) : (
          <CollapsedBlock
            key={block.id}
            block={block}
            summary={blockSummary(block)}
            superset={supersets.has(block.id)}
            onSelect={() => change((d) => ({ ...d, current_block_id: block.id }), false)}
          />
        ),
      )}
      <button type="button" class="btn-secondary strength-wide-btn" onClick={() => setPicking(true)}>
        + Add exercise
      </button>
      {picking && (
        <ExercisePicker
          sessionId={draft.id}
          onClose={() => setPicking(false)}
          onPick={(exercise, key) => {
            setPicking(false)
            change((d) => {
              const blocks = addBlock(d.blocks, exercise, key)
              return { ...d, blocks, current_block_id: blocks.at(-1)?.id }
            }, false)
          }}
        />
      )}
    </div>
  )
}
