import { useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useEffect, useState } from 'preact/hooks'

import { addActivity, updateActivity } from '../../state/api'
import { detailUrl, STRENGTH_TYPE } from './constants'
import { clearLogDraft, readLogDraft, writeLogDraft } from './draftStorage'
import { defaultTimes, sessionInterval, type SessionTimes } from './formModel'
import { invalidateStrengthQueries } from './queries'
import { BlocksEditor } from './SessionBlocks'
import { type ExerciseBlock, loggedSetCount, withExerciseKeys } from './sessionModel'

export interface EditTarget {
  id: string
  times: SessionTimes
  blocks: ExerciseBlock[]
}

export const PastSession = ({ edit }: { edit?: EditTarget }) => {
  const queryClient = useQueryClient()
  const { route } = useLocation()
  const [initial] = useState(() => (edit ? undefined : readLogDraft()))
  const [times, setTimes] = useState<SessionTimes>(() => edit?.times ?? initial ?? defaultTimes(new Date()))
  const [blocks, setBlocks] = useState<ExerciseBlock[]>(() => edit?.blocks ?? initial?.blocks ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    if (!edit) writeLogDraft({ ...times, blocks })
  }, [edit, times, blocks])

  const timeField = (key: keyof SessionTimes, label: string, type: string) => (
    <label class="strength-time-field">
      <span class="strength-field-label">{label}</span>
      <input
        type={type}
        inputMode={key === 'minutes' ? 'numeric' : undefined}
        value={times[key]}
        onInput={(e) => setTimes((t) => ({ ...t, [key]: (e.target as HTMLInputElement).value }))}
      />
    </label>
  )

  const save = async () => {
    const interval = sessionInterval(times)
    if (!interval) {
      setError('Enter a date, a start time and the minutes the session took.')
      return
    }
    setSaving(true)
    setError(undefined)
    try {
      const data = { sets: withExerciseKeys(blocks) }
      let id = edit?.id
      if (id) {
        await updateActivity(id, { ...interval, data })
      } else {
        const response = await addActivity({ activity_type: STRENGTH_TYPE, data, ...interval })
        id = response.data?.id
        if (!response.success || !id) throw new Error(response.error ?? 'not saved')
        clearLogDraft()
      }
      await invalidateStrengthQueries(queryClient)
      route(detailUrl(id))
    } catch {
      setError('The session could not be saved. Your entries are kept here; try again.')
      setSaving(false)
    }
  }

  const canSave = !saving && (edit !== undefined || loggedSetCount(blocks) > 0)

  return (
    <div class="strength-page">
      <header class="strength-sticky-header">
        <h1>{edit ? 'Edit session' : 'Log a past session'}</h1>
        <button type="button" class="btn-primary" onClick={() => void save()} disabled={!canSave}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </header>
      {error && <p class="strength-error">{error}</p>}
      <div class="strength-card strength-times">
        {timeField('date', 'Date', 'date')}
        {timeField('time', 'Start time', 'time')}
        {timeField('minutes', 'Minutes', 'text')}
      </div>
      <BlocksEditor blocks={blocks} onChange={(fn) => setBlocks(fn)} sessionId={edit?.id} />
    </div>
  )
}
