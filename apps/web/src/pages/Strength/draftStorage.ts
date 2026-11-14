import type { ExerciseBlock, SessionDraft } from './sessionModel'

export type DraftStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>

export interface PastDraft {
  date: string
  time: string
  minutes: string
  blocks: ExerciseBlock[]
}

export const LIVE_DRAFT_KEY = 'aurboda_strength_live'
export const LOG_DRAFT_KEY = 'aurboda_strength_log'
export const WEIGHT_STEP_KEY = 'aurboda_strength_weight_step'
export const REST_LENGTH_KEY = 'aurboda_strength_rest_s'

const VERSION = 1

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isRows = (v: unknown): v is Record<string, unknown>[] => Array.isArray(v) && v.every(isRecord)

const isBlock = (v: unknown): v is ExerciseBlock =>
  isRecord(v) &&
  typeof v.id === 'string' &&
  typeof v.exercise === 'string' &&
  isRows(v.sets) &&
  isRows(v.planned) &&
  (v.catalog_key === undefined || typeof v.catalog_key === 'string')

const isBlocks = (v: unknown): v is ExerciseBlock[] => Array.isArray(v) && v.every(isBlock)

const optionalString = (v: unknown): boolean => v === undefined || typeof v === 'string'

const isLiveDraft = (v: unknown): v is SessionDraft =>
  isRecord(v) &&
  typeof v.start_time === 'string' &&
  !Number.isNaN(Date.parse(v.start_time)) &&
  isBlocks(v.blocks) &&
  typeof v.rev === 'number' &&
  typeof v.saved_rev === 'number' &&
  optionalString(v.id) &&
  optionalString(v.last_set_at) &&
  optionalString(v.current_block_id)

const isPastDraft = (v: unknown): v is PastDraft =>
  isRecord(v) &&
  typeof v.date === 'string' &&
  typeof v.time === 'string' &&
  typeof v.minutes === 'string' &&
  isBlocks(v.blocks)

const read = <T>(
  storage: DraftStorage | undefined,
  key: string,
  valid: (v: unknown) => v is T,
): T | undefined => {
  let raw: string | null | undefined
  try {
    raw = storage?.getItem(key)
  } catch {
    return undefined
  }
  if (!raw) return undefined
  const parsed = parseJson(raw)
  if (isRecord(parsed) && parsed.version === VERSION && valid(parsed.draft)) return parsed.draft
  remove(storage, key)
  return undefined
}

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

const write = (storage: DraftStorage | undefined, key: string, draft: unknown): void => {
  try {
    storage?.setItem(key, JSON.stringify({ draft, version: VERSION }))
  } catch {
    // Storage full or blocked: the page state still holds the draft.
  }
}

const remove = (storage: DraftStorage | undefined, key: string): void => {
  try {
    storage?.removeItem(key)
  } catch {
    // Nothing to clear when storage is blocked.
  }
}

export const browserStorage = (): DraftStorage | undefined => {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export const readLiveDraft = (storage = browserStorage()): SessionDraft | undefined =>
  read(storage, LIVE_DRAFT_KEY, isLiveDraft)

export const writeLiveDraft = (draft: SessionDraft, storage = browserStorage()): void =>
  write(storage, LIVE_DRAFT_KEY, draft)

export const clearLiveDraft = (storage = browserStorage()): void => remove(storage, LIVE_DRAFT_KEY)

export const readLogDraft = (storage = browserStorage()): PastDraft | undefined =>
  read(storage, LOG_DRAFT_KEY, isPastDraft)

export const writeLogDraft = (draft: PastDraft, storage = browserStorage()): void =>
  write(storage, LOG_DRAFT_KEY, draft)

export const clearLogDraft = (storage = browserStorage()): void => remove(storage, LOG_DRAFT_KEY)

export const readNumberPref = (
  key: string,
  fallback: number,
  allowed: number[],
  storage = browserStorage(),
): number => {
  try {
    const value = Number(storage?.getItem(key))
    return allowed.includes(value) ? value : fallback
  } catch {
    return fallback
  }
}

export const writeNumberPref = (key: string, value: number, storage = browserStorage()): void => {
  try {
    storage?.setItem(key, String(value))
  } catch {
    // A preference that cannot be stored is only lost for the next visit.
  }
}
