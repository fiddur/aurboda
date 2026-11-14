import { useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useEffect, useState } from 'preact/hooks'

import { addActivity, updateActivity } from '../../state/api'
import { detailUrl, STRENGTH_TYPE } from './constants'
import { clearLogDraft, readLogDraft, writeLogDraft } from './draftStorage'
import { ExerciseBlockCard } from './ExerciseBlockCard'
import { ExercisePicker } from './ExercisePicker'
import {
  DEFAULT_WEIGHT_STEP,
  defaultTimes,
  parseNumber,
  sessionInterval,
  type SessionTimes,
} from './formModel'
import { invalidateStrengthQueries, useExerciseMuscles } from './queries'
import {
  addBlock,
  appendSets,
  deleteSet,
  type ExerciseBlock,
  expandQuickEntry,
  isTimedBlock,
  loggedSetCount,
  moveBlock,
  removeBlock,
  supersetBlockIds,
  updateSet,
  withExerciseKeys,
} from './sessionModel'

const MAX_QUICK_SETS = 50

const QuickEntry = ({
  blockId,
  onAdd,
}: {
  blockId: string
  onAdd: (count: number, reps?: number, weight?: number) => void
}) => {
  const [sets, setSets] = useState('3')
  const [reps, setReps] = useState('')
  const [weight, setWeight] = useState('')
  const count = parseNumber(sets) ?? 0
  const countValid = Number.isInteger(count) && count > 0 && count <= MAX_QUICK_SETS
  const valid = countValid && parseNumber(reps) !== undefined
  const field = (id: string, label: string, value: string, set: (v: string) => void, decimal = false) => (
    <label class="strength-quick-field" for={`${blockId}-${id}`}>
      <span class="strength-field-label">{label}</span>
      <input
        id={`${blockId}-${id}`}
        type="text"
        inputMode={decimal ? 'decimal' : 'numeric'}
        autocomplete="off"
        value={value}
        onInput={(e) => set((e.target as HTMLInputElement).value)}
      />
    </label>
  )
  return (
    <form
      class="strength-quick-entry"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        onAdd(count, parseNumber(reps), parseNumber(weight))
        setReps('')
      }}
    >
      <div class="strength-quick-row">
        {field('sets', 'Sets', sets, setSets)}
        <span class="strength-quick-sep" aria-hidden="true">
          ×
        </span>
        {field('reps', 'Reps', reps, setReps)}
        <span class="strength-quick-sep" aria-hidden="true">
          at
        </span>
        {field('weight', 'Weight (kg)', weight, setWeight, true)}
      </div>
      <button type="submit" class="btn-secondary strength-wide-btn" disabled={!valid}>
        {countValid ? `Add ${count} ${count === 1 ? 'set' : 'sets'}` : 'Add sets'}
      </button>
      <p class="strength-muted strength-hint">The sets become rows you can edit one by one.</p>
    </form>
  )
}

const PastBlock = ({
  block,
  blocks,
  superset,
  onChange,
}: {
  block: ExerciseBlock
  blocks: ExerciseBlock[]
  superset: boolean
  onChange: (fn: (blocks: ExerciseBlock[]) => ExerciseBlock[]) => void
}) => {
  const muscles = useExerciseMuscles(block.exercise)
  return (
    <ExerciseBlockCard
      block={block}
      position={blocks.findIndex((b) => b.id === block.id)}
      count={blocks.length}
      muscles={muscles}
      superset={superset}
      timed={isTimedBlock(block)}
      weightStep={DEFAULT_WEIGHT_STEP}
      onUpdateSet={(i, set) => onChange((bs) => updateSet(bs, block.id, i, set))}
      onDeleteSet={(i) => onChange((bs) => deleteSet(bs, block.id, i))}
      onRemove={() => onChange((bs) => removeBlock(bs, block.id))}
      onMove={(delta) => onChange((bs) => moveBlock(bs, block.id, delta))}
    >
      <QuickEntry
        blockId={block.id}
        onAdd={(count, reps, weight) =>
          onChange((bs) => appendSets(bs, block.id, expandQuickEntry(count, reps, weight)))
        }
      />
    </ExerciseBlockCard>
  )
}

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
  const [picking, setPicking] = useState(false)
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

  const supersets = supersetBlockIds(blocks)
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
      {blocks.map((block) => (
        <PastBlock
          key={block.id}
          block={block}
          blocks={blocks}
          superset={supersets.has(block.id)}
          onChange={(fn) => setBlocks(fn)}
        />
      ))}
      <button type="button" class="btn-secondary strength-wide-btn" onClick={() => setPicking(true)}>
        + Add exercise
      </button>
      {picking && (
        <ExercisePicker
          sessionId={edit?.id}
          onClose={() => setPicking(false)}
          onPick={(exercise, key) => {
            setPicking(false)
            setBlocks((bs) => addBlock(bs, exercise, key))
          }}
        />
      )}
    </div>
  )
}
