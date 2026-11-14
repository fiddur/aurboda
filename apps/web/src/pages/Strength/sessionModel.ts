import { isSameName } from '../../components/knownValueSuggestions'

export type SetRow = Record<string, unknown>

export interface ExerciseBlock {
  id: string
  exercise: string
  sets: SetRow[]
  planned: SetRow[]
  catalog_key?: string
}

export interface SessionDraft {
  id?: string
  start_time: string
  blocks: ExerciseBlock[]
  current_block_id?: string
  last_set_at?: string
  rev: number
  saved_rev: number
  create_attempted?: boolean
}

export type MakeId = () => string

let blockCounter = 0
export const makeBlockId: MakeId = () => `b${Date.now().toString(36)}${(blockCounter++).toString(36)}`

const PREFILL_FIELDS = ['weight', 'reps', 'time'] as const

export type SetPrefill = Partial<Record<(typeof PREFILL_FIELDS)[number], number>>

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

const exerciseOf = (set: SetRow): string => (typeof set.exercise === 'string' ? set.exercise : '')

export const isInProgress = (data: Record<string, unknown> | null | undefined): boolean =>
  data?.in_progress === true

export const isDirty = (draft: Pick<SessionDraft, 'rev' | 'saved_rev'>): boolean =>
  draft.rev !== draft.saved_rev

export const setsOfData = (data: Record<string, unknown> | null | undefined): SetRow[] =>
  Array.isArray(data?.sets)
    ? data.sets.filter((s): s is SetRow => typeof s === 'object' && s !== null && !Array.isArray(s))
    : []

export const blocksFromSets = (sets: SetRow[], makeId: MakeId = makeBlockId): ExerciseBlock[] =>
  sets.reduce<ExerciseBlock[]>((blocks, set) => {
    const last = blocks.at(-1)
    if (last && isSameName(last.exercise, exerciseOf(set))) {
      return [...blocks.slice(0, -1), { ...last, sets: [...last.sets, set] }]
    }
    return [...blocks, { exercise: exerciseOf(set), id: makeId(), planned: [], sets: [set] }]
  }, [])

export const setsFromBlocks = (blocks: ExerciseBlock[]): SetRow[] => blocks.flatMap((b) => b.sets)

export const withExerciseKeys = (blocks: ExerciseBlock[]): SetRow[] =>
  blocks.flatMap((b) => {
    const key = b.catalog_key
    return key ? b.sets.map((s) => ({ ...s, exercise_key: key })) : b.sets
  })

export const clearSavedExerciseKeys = (blocks: ExerciseBlock[], saved: ExerciseBlock[]): ExerciseBlock[] => {
  const sent = new Set(saved.filter((b) => b.catalog_key && b.sets.length > 0).map((b) => b.id))
  return blocks.map((b) => {
    if (!sent.has(b.id)) return b
    const { catalog_key: _, ...rest } = b
    return rest
  })
}

export const addBlock = (
  blocks: ExerciseBlock[],
  exercise: string,
  catalogKey?: string,
  makeId: MakeId = makeBlockId,
): ExerciseBlock[] => [
  ...blocks,
  { exercise, id: makeId(), planned: [], sets: [], ...(catalogKey ? { catalog_key: catalogKey } : {}) },
]

export const removeBlock = (blocks: ExerciseBlock[], id: string): ExerciseBlock[] =>
  blocks.filter((b) => b.id !== id)

export const moveBlock = (blocks: ExerciseBlock[], id: string, delta: number): ExerciseBlock[] => {
  const from = blocks.findIndex((b) => b.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= blocks.length) return blocks
  const next = [...blocks]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

const mapBlock = (blocks: ExerciseBlock[], id: string, fn: (b: ExerciseBlock) => ExerciseBlock) =>
  blocks.map((b) => (b.id === id ? fn(b) : b))

const withoutUndefined = (row: SetRow): SetRow =>
  Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined && v !== ''))

export const logSet = (blocks: ExerciseBlock[], blockId: string, set: SetRow): ExerciseBlock[] =>
  mapBlock(blocks, blockId, (b) => ({
    ...b,
    planned: b.planned.slice(1),
    sets: [...b.sets, withoutUndefined({ ...set, exercise: b.exercise })],
  }))

export const appendSets = (blocks: ExerciseBlock[], blockId: string, sets: SetRow[]): ExerciseBlock[] =>
  mapBlock(blocks, blockId, (b) => ({
    ...b,
    sets: [...b.sets, ...sets.map((s) => withoutUndefined({ ...s, exercise: b.exercise }))],
  }))

export const updateSet = (
  blocks: ExerciseBlock[],
  blockId: string,
  index: number,
  patch: SetRow,
): ExerciseBlock[] =>
  mapBlock(blocks, blockId, (b) => ({
    ...b,
    sets: b.sets.map((s, i) => {
      if (i !== index) return s
      const merged = { ...s, ...patch }
      for (const [k, v] of Object.entries(patch)) if (v === undefined || v === '') delete merged[k]
      return merged
    }),
  }))

export const deleteSet = (blocks: ExerciseBlock[], blockId: string, index: number): ExerciseBlock[] =>
  mapBlock(blocks, blockId, (b) => ({ ...b, sets: b.sets.filter((_, i) => i !== index) }))

export const expandQuickEntry = (count: number, reps?: number, weight?: number): SetRow[] =>
  Number.isInteger(count) && count > 0
    ? Array.from({ length: count }, () => withoutUndefined({ reps, weight }))
    : []

const prefillOf = (set: SetRow | undefined): SetPrefill =>
  set
    ? Object.fromEntries(PREFILL_FIELDS.flatMap((f) => (num(set[f]) === undefined ? [] : [[f, num(set[f])]])))
    : {}

export const nextSetPrefill = (block: ExerciseBlock, lastTime: SetRow[] = []): SetPrefill => {
  const index = block.sets.length
  const source = block.sets.at(-1) ?? block.planned[0] ?? lastTime[index]
  return prefillOf(source)
}

const isTimed = (set: SetRow | undefined): boolean =>
  set !== undefined && num(set.time) !== undefined && num(set.reps) === undefined

export const isTimedBlock = (block: ExerciseBlock, lastTime: SetRow[] = []): boolean =>
  isTimed(block.sets.at(-1) ?? block.planned[0] ?? lastTime.at(-1))

const SET_TYPE_LABELS: Record<string, string> = { drop_set: 'drop set', failure: 'failure', warmup: 'warmup' }

const formatSeconds = (seconds: number): string => {
  const total = Math.round(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export const setLabel = (set: SetRow): string => {
  const weight = num(set.weight)
  const reps = num(set.reps)
  const time = num(set.time)
  const distance = num(set.distance)
  const parts: string[] = []
  if (weight !== undefined && reps !== undefined) parts.push(`${weight} kg × ${reps}`)
  else if (weight !== undefined) parts.push(`${weight} kg`)
  else if (reps !== undefined) parts.push(`${reps} reps`)
  if (time !== undefined) parts.push(formatSeconds(time))
  if (distance !== undefined) parts.push(`${distance} m`)
  if (parts.length === 0) parts.push('—')
  const type = typeof set.set_type === 'string' ? SET_TYPE_LABELS[set.set_type] : undefined
  return type ? `${parts.join(', ')} (${type})` : parts.join(', ')
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

export const blockSummary = (block: Pick<ExerciseBlock, 'sets' | 'planned'>): string => {
  if (block.sets.length === 0) {
    return block.planned.length > 0 ? `${plural(block.planned.length, 'set', 'sets')} planned` : 'No sets yet'
  }
  const reps = block.sets.map((s) => num(s.reps))
  const head = plural(block.sets.length, 'set', 'sets')
  if (reps.every((r) => r !== undefined)) return `${head}: ${reps.join(', ')} reps`
  return `${head}: ${block.sets.map(setLabel).join(', ')}`
}

export const sessionSummary = (blocks: ExerciseBlock[]): string => {
  const logged = blocks.filter((b) => b.sets.length > 0)
  const names = logged.reduce<string[]>(
    (acc, b) => (acc.some((n) => isSameName(n, b.exercise)) ? acc : [...acc, b.exercise]),
    [],
  )
  const sets = logged.reduce((n, b) => n + b.sets.length, 0)
  return `${plural(names.length, 'exercise', 'exercises')}, ${plural(sets, 'set', 'sets')}`
}

export const exerciseNames = (sets: SetRow[]): string[] =>
  sets.reduce<string[]>((acc, s) => {
    const name = exerciseOf(s)
    return name === '' || acc.some((n) => isSameName(n, name)) ? acc : [...acc, name]
  }, [])

export const planFromSession = (sets: SetRow[], makeId: MakeId = makeBlockId): ExerciseBlock[] =>
  blocksFromSets(sets, makeId).map((b) => ({ ...b, planned: b.sets.map(prefillOf), sets: [] }))

export const newLiveDraft = (startTime: string, blocks: ExerciseBlock[] = []): SessionDraft => ({
  blocks,
  current_block_id: blocks[0]?.id,
  rev: 0,
  saved_rev: 0,
  start_time: startTime,
})

export const liveDraftFromServer = (
  activity: { id: string; start_time: string; data?: Record<string, unknown> },
  makeId: MakeId = makeBlockId,
): SessionDraft => {
  const blocks = blocksFromSets(setsOfData(activity.data), makeId)
  const lastSetAt = activity.data?.last_set_at
  return {
    blocks,
    current_block_id: blocks.at(-1)?.id,
    id: activity.id,
    rev: 0,
    saved_rev: 0,
    start_time: activity.start_time,
    ...(typeof lastSetAt === 'string' ? { last_set_at: lastSetAt } : {}),
  }
}

export const loggedSetCount = (blocks: ExerciseBlock[]): number =>
  blocks.reduce((n, b) => n + b.sets.length, 0)

export const supersetBlockIds = (blocks: ExerciseBlock[]): Set<string> => {
  const owners = new Map<unknown, Set<string>>()
  for (const b of blocks) {
    for (const s of b.sets) {
      if (s.superset_id === undefined || s.superset_id === null || s.superset_id === '') continue
      owners.set(s.superset_id, (owners.get(s.superset_id) ?? new Set()).add(b.id))
    }
  }
  return new Set([...owners.values()].filter((ids) => ids.size > 1).flatMap((ids) => [...ids]))
}

export const setsOfExercise = (blocks: ExerciseBlock[], exercise: string): SetRow[] =>
  blocks.filter((b) => isSameName(b.exercise, exercise)).flatMap((b) => b.sets)
