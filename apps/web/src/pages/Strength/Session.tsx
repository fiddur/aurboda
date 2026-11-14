import { useQuery } from '@tanstack/react-query'
import { useLocation, useRoute } from 'preact-iso'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import type { Activity } from '../../state/api/types'

import { fetchActivityById } from '../../state/api'
import { detailUrl, sessionUrl, STRENGTH_TYPE } from './constants'
import { readLiveDraft, writeLiveDraft } from './draftStorage'
import { timesFromActivity } from './formModel'
import { LiveSession } from './LiveSession'
import { PastSession } from './PastSession'
import {
  blocksFromSets,
  isDirty,
  isInProgress,
  liveDraftFromServer,
  loggedSetCount,
  newLiveDraft,
  planFromSession,
  type SessionDraft,
  setLabel,
  setsOfData,
} from './sessionModel'
import './style.css'

interface LiveState {
  key: string
  draft: SessionDraft
}

const isEditable = (activity: Activity & { source_records?: unknown[] }, id: string): boolean =>
  activity.source === 'aurboda' &&
  !activity.override_target_ids?.length &&
  !id.startsWith('merged:') &&
  (activity.source_records?.length ?? 0) <= 1

const ReadOnlySession = ({ activity, id }: { activity: Activity; id: string }) => (
  <div class="strength-page">
    <header class="strength-sticky-header">
      <h1>Session</h1>
      <a class="btn-secondary" href={detailUrl(id)}>
        Open the session
      </a>
    </header>
    <p class="strength-muted">
      This session comes from {activity.source ?? 'another source'}; change it on the session page.
    </p>
    {blocksFromSets(setsOfData(activity.data)).map((block) => (
      <section key={block.id} class="strength-card strength-block">
        <h2>{block.exercise}</h2>
        <ol class="strength-sets">
          {block.sets.map((set, i) => (
            <li key={i} class="strength-set strength-set-row">
              <span class="strength-set-number">{i + 1}</span>
              <span class="strength-set-label">{setLabel(set)}</span>
            </li>
          ))}
        </ol>
      </section>
    ))}
  </div>
)

const OtherDraftNotice = ({ draft }: { draft: SessionDraft }) => (
  <div class="strength-page">
    <h1>Session</h1>
    <div class="strength-card">
      <p>
        This device holds another session with sets that are not saved yet. Finish or continue that one first.
      </p>
      <a class="btn-primary" href={draft.id ? sessionUrl(draft.id) : '/strength/live'}>
        Continue that session
      </a>
    </div>
  </div>
)

type SavedMode =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'live'; draft: SessionDraft }
  | { kind: 'other-draft'; draft: SessionDraft }
  | { kind: 'read-only'; activity: Activity }
  | { kind: 'edit'; activity: Activity }

/** A dirty local draft of this session wins over the server copy; one of another session blocks it. */
const savedMode = (
  id: string,
  loading: boolean,
  activity: Activity | undefined,
  local: SessionDraft | undefined,
): SavedMode => {
  if (loading) return { kind: 'loading' }
  const localForThis = local?.id === id ? local : undefined
  if (!activity) return localForThis ? { draft: localForThis, kind: 'live' } : { kind: 'error' }
  if (isInProgress(activity.data)) {
    if (local && local.id !== id && isDirty(local) && loggedSetCount(local.blocks) > 0) {
      return { draft: local, kind: 'other-draft' }
    }
    const draft =
      localForThis && isDirty(localForThis)
        ? localForThis
        : liveDraftFromServer({ data: activity.data, id, start_time: activity.start_time.toISOString() })
    return { draft, kind: 'live' }
  }
  return activity.activity_type === STRENGTH_TYPE && isEditable(activity, id)
    ? { activity, kind: 'edit' }
    : { activity, kind: 'read-only' }
}

const SavedSession = ({ id, onLive }: { id: string; onLive: (state: LiveState) => void }) => {
  const query = useQuery({
    gcTime: 0,
    queryFn: () => fetchActivityById(id),
    queryKey: ['entity-detail', 'activity', id, 'strength'],
    retry: 1,
    staleTime: 0,
  })
  const [local] = useState(() => readLiveDraft())
  const activity = query.data?.activity
  const mode = useMemo(
    () => savedMode(id, query.isLoading, activity, local),
    [id, query.isLoading, activity, local],
  )
  const liveDraft = mode.kind === 'live' ? mode.draft : undefined

  useEffect(() => {
    if (!liveDraft) return
    writeLiveDraft(liveDraft)
    onLive({ draft: liveDraft, key: id })
  }, [liveDraft, id, onLive])

  switch (mode.kind) {
    case 'loading':
    case 'live':
      return <p class="loading">Loading…</p>
    case 'error':
      return <p class="error">The session could not be loaded.</p>
    case 'other-draft':
      return <OtherDraftNotice draft={mode.draft} />
    case 'read-only':
      return <ReadOnlySession activity={mode.activity} id={id} />
    case 'edit':
      return (
        <PastSession
          edit={{
            blocks: blocksFromSets(setsOfData(mode.activity.data)),
            id,
            times: timesFromActivity(mode.activity.start_time, mode.activity.end_time),
          }}
        />
      )
  }
}

const NewSession = ({ repeat, onLive }: { repeat?: string; onLive: (state: LiveState) => void }) => {
  const { route } = useLocation()
  const [startedAt] = useState(() => new Date().toISOString())
  const [local] = useState(() => readLiveDraft())
  const resumable = local && (local.id || loggedSetCount(local.blocks) > 0) ? local : undefined
  const source = useQuery({
    enabled: !resumable && Boolean(repeat),
    queryFn: () => fetchActivityById(repeat ?? ''),
    queryKey: ['entity-detail', 'activity', repeat, 'strength'],
    retry: 1,
  })

  useEffect(() => {
    if (resumable?.id) {
      route(sessionUrl(resumable.id), true)
      return
    }
    if (resumable) {
      onLive({ draft: resumable, key: 'local' })
      return
    }
    if (repeat && source.isLoading) return
    const plan = source.data ? planFromSession(setsOfData(source.data.activity.data)) : []
    const draft = newLiveDraft(startedAt, plan)
    writeLiveDraft(draft)
    onLive({ draft, key: 'new' })
  }, [resumable, repeat, source.isLoading, source.data, startedAt, route, onLive])

  return <p class="loading">Loading…</p>
}

export function StrengthSession() {
  const { params, query } = useRoute()
  const routeId = params.id as string | undefined
  const [live, setLive] = useState<LiveState | undefined>()
  const liveId = useRef<string | undefined>(undefined)

  const showLive = live !== undefined && routeId === liveId.current

  const onLive = useRef((state: LiveState) => {
    liveId.current = state.draft.id
    setLive(state)
  }).current

  if (showLive) {
    return (
      <LiveSession
        key={live.key}
        initial={live.draft}
        onId={(id) => {
          liveId.current = id
        }}
      />
    )
  }
  if (routeId) return <SavedSession key={routeId} id={routeId} onLive={onLive} />
  return <NewSession repeat={query.repeat} onLive={onLive} />
}

export function StrengthLog() {
  return <PastSession />
}
