import type { StrengthPlan } from '@aurboda/api-spec'

import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { format } from 'date-fns'
import { useLocation, useRoute } from 'preact-iso'
import { useEffect, useRef, useState } from 'preact/hooks'

import type { ExerciseBlock } from './sessionModel'

import {
  createStrengthPlan,
  deleteStrengthPlan,
  fetchActivityById,
  fetchStrengthPlan,
  updateActivity,
  updateStrengthPlan,
} from '../../state/api'
import { sessionUrl } from './constants'
import { blocksFromPlan, planBody, planFormError } from './planModel'
import { invalidateStrengthQueries } from './queries'
import { BlocksEditor } from './SessionBlocks'
import { blocksFromSets, isEditable, setsOfData } from './sessionModel'
import './style.css'

const invalidatePlans = (queryClient: QueryClient): Promise<unknown> =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: ['strength-plans'] }),
    queryClient.invalidateQueries({ queryKey: ['strength-plan'] }),
  ])

const isNotFound = (error: unknown): boolean => axios.isAxiosError(error) && error.response?.status === 404

const PlanSessions = ({ sessions }: { sessions: StrengthPlan['sessions'] }) =>
  sessions.length === 0 ? null : (
    <p class="strength-muted">
      Done on{' '}
      {sessions.map((s, i) => (
        <span key={s.activity_id}>
          {i > 0 && ', '}
          <a href={sessionUrl(s.activity_id)}>{format(new Date(s.start_time), 'd MMM')}</a>
        </span>
      ))}
    </p>
  )

interface SourceSession {
  blocks: ExerciseBlock[]
  /** The session to tie to the new plan; absent when its data cannot be changed safely or it has a plan. */
  link_id?: string
}

const linkSession = async (activityId: string, planId: string): Promise<void> => {
  try {
    await updateActivity(activityId, { data: { plan_id: planId } })
  } catch {
    // The plan is saved either way; the link only feeds "Saved as" and "Last done".
  }
}

const createPlan = async (
  body: ReturnType<typeof planBody>,
  source: SourceSession | undefined,
  queryClient: QueryClient,
): Promise<void> => {
  const created = await createStrengthPlan(body)
  if (!source?.link_id) return
  await linkSession(source.link_id, created.id)
  await invalidateStrengthQueries(queryClient)
}

const formTitle = (plan: StrengthPlan | undefined, fromSession: boolean | undefined): string => {
  if (plan) return 'Edit plan'
  return fromSession ? 'Save as a workout' : 'New plan'
}

const PlanForm = ({
  plan,
  fromSession,
  source,
  sourceError,
}: {
  plan?: StrengthPlan
  fromSession?: boolean
  source?: SourceSession
  sourceError?: boolean
}) => {
  const queryClient = useQueryClient()
  const { route } = useLocation()
  const [name, setName] = useState(plan?.name ?? '')
  const [day, setDay] = useState(plan?.planned_for ?? '')
  const [note, setNote] = useState(plan?.note ?? '')
  const [blocks, setBlocks] = useState<ExerciseBlock[]>(() =>
    plan ? blocksFromPlan(plan.sets) : (source?.blocks ?? []),
  )
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (fromSession) nameRef.current?.focus()
  }, [fromSession])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = async () => {
    const formError = planFormError(name, blocks)
    if (formError) {
      setError(formError)
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const body = planBody({ day, name, note }, blocks)
      if (plan) await updateStrengthPlan(plan.id, body)
      else await createPlan(body, source, queryClient)
      await invalidatePlans(queryClient)
      route('/strength/workouts')
    } catch {
      setError('The plan could not be saved. Try again.')
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!plan) return
    setBusy(true)
    setError(undefined)
    try {
      await deleteStrengthPlan(plan.id)
      await invalidatePlans(queryClient)
      route('/strength/workouts')
    } catch {
      setError('The plan could not be deleted. Try again.')
      setBusy(false)
      setConfirmDelete(false)
    }
  }

  return (
    <div class="page page--narrow strength-page">
      <header class="strength-sticky-header">
        <h1>{formTitle(plan, fromSession)}</h1>
        <button type="button" class="btn-primary" onClick={() => void save()} disabled={busy}>
          {busy && !confirmDelete ? 'Saving…' : 'Save'}
        </button>
      </header>
      {sourceError && <p class="strength-error">That session could not be loaded.</p>}
      {error && <p class="strength-error">{error}</p>}
      <div class="strength-card strength-plan-fields">
        <label>
          <span class="strength-field-label">Name</span>
          <input
            ref={nameRef}
            type="text"
            required
            maxLength={120}
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          <span class="strength-field-label">Day</span>
          <input type="date" value={day} onInput={(e) => setDay((e.target as HTMLInputElement).value)} />
          <span class="strength-muted strength-hint">
            Leave the day empty to keep it as a saved workout you can start any time.
          </span>
        </label>
        <label>
          <span class="strength-field-label">Note</span>
          <textarea
            rows={3}
            maxLength={2000}
            value={note}
            onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
          />
        </label>
      </div>
      <BlocksEditor blocks={blocks} onChange={(fn) => setBlocks(fn)} />
      {plan && <PlanSessions sessions={plan.sessions} />}
      {plan &&
        (confirmDelete ? (
          <div class="strength-card strength-confirm" role="alert">
            <p>Delete this plan?</p>
            <div class="strength-row-actions">
              <button type="button" class="btn-primary" disabled={busy} onClick={() => void remove()}>
                {busy ? 'Deleting…' : 'Delete'}
              </button>
              <button type="button" class="btn-secondary" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            class="btn-secondary strength-wide-btn"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            Delete plan
          </button>
        ))}
    </div>
  )
}

const ExistingPlan = ({ id }: { id: string }) => {
  const query = useQuery({
    gcTime: 0,
    queryFn: () => fetchStrengthPlan(id),
    queryKey: ['strength-plan', id],
    retry: (count, error) => !isNotFound(error) && count < 1,
    staleTime: 0,
  })
  if (query.isLoading) return <p class="loading">Loading…</p>
  if (!query.data) {
    return (
      <div class="page page--narrow strength-page">
        <p class={isNotFound(query.error) ? undefined : 'strength-error'}>
          {isNotFound(query.error) ? 'This plan no longer exists.' : 'The plan could not be loaded.'}
        </p>
        <a href="/strength/workouts">Back to strength training</a>
      </div>
    )
  }
  return <PlanForm plan={query.data} />
}

const FromSession = ({ id }: { id: string }) => {
  const query = useQuery({
    gcTime: 0,
    queryFn: () => fetchActivityById(id),
    queryKey: ['entity-detail', 'activity', id, 'strength'],
    retry: 1,
    staleTime: 0,
  })
  if (query.isLoading) return <p class="loading">Loading…</p>
  const activity = query.data?.activity
  if (!activity) return <PlanForm fromSession sourceError />
  const source: SourceSession = {
    blocks: blocksFromSets(setsOfData(activity.data)),
    ...(isEditable(activity, id) && !activity.data?.plan_id ? { link_id: id } : {}),
  }
  return <PlanForm fromSession source={source} />
}

export function StrengthPlanEditor() {
  const { params } = useRoute()
  const { query } = useLocation()
  const id = params.id as string | undefined
  if (id) return <ExistingPlan key={id} id={id} />
  const from = query.from
  return from ? <FromSession key={from} id={from} /> : <PlanForm />
}
