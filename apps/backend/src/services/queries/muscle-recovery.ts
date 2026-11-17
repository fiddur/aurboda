import {
  MUSCLE_RECOVERY_WINDOW_DAYS,
  type MuscleRecovery,
  type MuscleRecoveryHistory,
} from '@aurboda/api-spec'

import type { ItemValueResult } from '../item-value-aliases.ts'

import {
  type FatigueRecord,
  fatigueSets,
  muscleRecoveryAt,
  muscleRecoveryHistory,
} from '../muscle-recovery.ts'
import { loadSessions, type Period } from './muscle-group-history.ts'

const WINDOW_MS = MUSCLE_RECOVERY_WINDOW_DAYS * 86_400_000

export interface MuscleRecoveryDeps {
  loadSessions: typeof loadSessions
}

const defaultDeps = (): MuscleRecoveryDeps => ({ loadSessions })

const loadFatigue = async (
  user: string,
  activityType: string,
  path: string,
  period: Period,
  deps: MuscleRecoveryDeps,
): Promise<ItemValueResult<FatigueRecord[]>> => {
  const loaded = await deps.loadSessions(user, activityType, path, period)
  if (!loaded.success) return loaded
  const { key, resolverOf, sessions } = loaded.data
  return { data: fatigueSets(sessions, key, resolverOf), success: true }
}

export const queryMuscleRecovery = async (
  user: string,
  activityType: string,
  path: string,
  at: Date,
  deps: MuscleRecoveryDeps = defaultDeps(),
): Promise<ItemValueResult<MuscleRecovery>> => {
  const period = { end: at, start: new Date(at.getTime() - WINDOW_MS) }
  const loaded = await loadFatigue(user, activityType, path, period, deps)
  if (!loaded.success) return loaded
  return { data: muscleRecoveryAt(loaded.data, at, path), success: true }
}

export const queryMuscleRecoveryHistory = async (
  user: string,
  activityType: string,
  path: string,
  period: { end: Date; start: Date; step_hours: number },
  deps: MuscleRecoveryDeps = defaultDeps(),
): Promise<ItemValueResult<MuscleRecoveryHistory>> => {
  const window = { end: period.end, start: new Date(period.start.getTime() - WINDOW_MS) }
  const loaded = await loadFatigue(user, activityType, path, window, deps)
  if (!loaded.success) return loaded
  return { data: muscleRecoveryHistory(loaded.data, period, path), success: true }
}
