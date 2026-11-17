import { STRENGTH_SCORE_WINDOW_DAYS, type StrengthScore, type StrengthScoreHistory } from '@aurboda/api-spec'

import type { ItemValueResult } from '../item-value-aliases.ts'

import { getTimeSeries, getUserSettings } from '../../db/index.ts'
import { loadStrengthReferences, type StrengthReferences } from '../strength-references.ts'
import {
  bodyweightLookup,
  type ScoredSet,
  scoredSets,
  strengthScoreAt,
  strengthScoreHistory,
  type StrengthScoreSubject,
} from '../strength-score.ts'
import { loadSessions, type Period } from './muscle-group-history.ts'

const WINDOW_MS = STRENGTH_SCORE_WINDOW_DAYS * 86_400_000

export interface StrengthScoreDeps {
  getTimeSeries: typeof getTimeSeries
  getUserSettings: typeof getUserSettings
  loadSessions: typeof loadSessions
  loadStrengthReferences: () => StrengthReferences
}

const defaultDeps = (): StrengthScoreDeps => ({
  getTimeSeries,
  getUserSettings,
  loadSessions,
  loadStrengthReferences,
})

interface Loaded {
  references: StrengthReferences
  sets: ScoredSet[]
  subject: StrengthScoreSubject
}

/** The scored sets of sessions starting within `period`, and what the user has given for a score. */
const loadScoredSets = async (
  user: string,
  activityType: string,
  path: string,
  period: Period,
  deps: StrengthScoreDeps,
): Promise<ItemValueResult<Loaded>> => {
  const loaded = await deps.loadSessions(user, activityType, path, period)
  if (!loaded.success) return loaded
  const [weights, settings] = await Promise.all([
    deps.getTimeSeries(user, 'weight', new Date(0), new Date()),
    deps.getUserSettings(user),
  ])
  const references = deps.loadStrengthReferences()
  const { key, resolverOf, sessions } = loaded.data
  return {
    data: {
      references,
      sets: scoredSets(sessions, key, resolverOf, references, bodyweightLookup(weights)),
      subject: { has_bodyweight: weights.length > 0, sex: settings?.sex ?? undefined },
    },
    success: true,
  }
}

export const queryStrengthScore = async (
  user: string,
  activityType: string,
  path: string,
  at: Date,
  deps: StrengthScoreDeps = defaultDeps(),
): Promise<ItemValueResult<StrengthScore>> => {
  const period = { end: at, start: new Date(at.getTime() - WINDOW_MS) }
  const loaded = await loadScoredSets(user, activityType, path, period, deps)
  if (!loaded.success) return loaded
  const { references, sets, subject } = loaded.data
  return { data: strengthScoreAt(sets, references, subject, at, path), success: true }
}

export const queryStrengthScoreHistory = async (
  user: string,
  activityType: string,
  path: string,
  period: { end: Date; start: Date; step_days: number },
  deps: StrengthScoreDeps = defaultDeps(),
): Promise<ItemValueResult<StrengthScoreHistory>> => {
  const window = { end: period.end, start: new Date(period.start.getTime() - WINDOW_MS) }
  const loaded = await loadScoredSets(user, activityType, path, window, deps)
  if (!loaded.success) return loaded
  const { references, sets, subject } = loaded.data
  return { data: strengthScoreHistory(sets, references, subject, period, path), success: true }
}
