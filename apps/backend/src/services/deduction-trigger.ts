/**
 * Deduction rule evaluation trigger with per-user debouncing.
 *
 * When data is synced, we debounce rule evaluation by 5 seconds per user.
 * Multiple syncs within the debounce window merge their time ranges.
 */

import type { DeductionRule } from '@aurboda/api-spec'

import type { DeductionEngineDeps, EvaluationWindow } from './deduction-engine.ts'

import { auditError, auditInfo } from './audit-log.ts'

export interface DeductionTriggerDeps {
  getEnabledRules: (user: string) => Promise<DeductionRule[]>
  evaluateAllRules: (
    user: string,
    rules: DeductionRule[],
    window: EvaluationWindow,
    deps: DeductionEngineDeps,
  ) => Promise<{ rules_evaluated: number; activities_created: number }>
  engineDeps: DeductionEngineDeps
}

export interface DeductionTrigger {
  triggerEvaluation: (user: string, dataWindow: EvaluationWindow) => void
  clearPending: () => void
  getPendingCount: () => number
}

const DEBOUNCE_MS = 5000
const WINDOW_BUFFER_MS = 60 * 60 * 1000 // 1 hour buffer on each side

export const createDeductionTrigger = (deps: DeductionTriggerDeps): DeductionTrigger => {
  const pendingEvaluations = new Map<string, { timeout: NodeJS.Timeout; window: EvaluationWindow }>()

  const executeEvaluation = async (user: string, window: EvaluationWindow) => {
    try {
      const rules = await deps.getEnabledRules(user)
      if (rules.length === 0) return

      // Expand window by buffer
      const expandedWindow: EvaluationWindow = {
        end: new Date(window.end.getTime() + WINDOW_BUFFER_MS),
        start: new Date(window.start.getTime() - WINDOW_BUFFER_MS),
      }

      const result = await deps.evaluateAllRules(user, rules, expandedWindow, deps.engineDeps)
      auditInfo(user, 'deduction', 'Rule evaluation completed', {
        activities_created: result.activities_created,
        rules_evaluated: result.rules_evaluated,
      })
    } catch (err) {
      auditError(user, 'deduction', 'Rule evaluation failed', { error: String(err) })
    }
  }

  return {
    clearPending: () => {
      for (const { timeout } of pendingEvaluations.values()) {
        clearTimeout(timeout)
      }
      pendingEvaluations.clear()
    },

    getPendingCount: () => pendingEvaluations.size,

    triggerEvaluation: (user: string, dataWindow: EvaluationWindow) => {
      const existing = pendingEvaluations.get(user)
      if (existing) {
        clearTimeout(existing.timeout)
        // Merge windows: take the wider range
        dataWindow = {
          end: new Date(Math.max(dataWindow.end.getTime(), existing.window.end.getTime())),
          start: new Date(Math.min(dataWindow.start.getTime(), existing.window.start.getTime())),
        }
      }

      const timeout = setTimeout(() => {
        pendingEvaluations.delete(user)
        executeEvaluation(user, dataWindow)
      }, DEBOUNCE_MS)

      pendingEvaluations.set(user, { timeout, window: dataWindow })
    },
  }
}
