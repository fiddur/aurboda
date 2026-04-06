/**
 * Deduction Rules list page — shows all deduction rules with enable toggles and actions.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useState } from 'preact/hooks'

import type { DeductionRule, DeductionRuleCondition } from '../../state/api'

import { ConfirmButton } from '../../components/ConfirmButton'
import {
  deleteDeductionRule,
  evaluateDeductionRules,
  fetchDeductionRules,
  updateDeductionRule,
} from '../../state/api'
import { auth } from '../../state/auth'
import './style.css'

// ============================================================================
// Helpers
// ============================================================================

const formatCondition = (c: DeductionRuleCondition): string => {
  switch (c.kind) {
    case 'activity':
      return `Activity: ${c.activity_type}`
    case 'tag':
      return `Tag: ${c.tag_name}`
    case 'screentime_category':
      return `Screen: ${c.category?.join(' > ')}`
    default:
      return c.kind
  }
}

const formatConditions = (conditions: DeductionRuleCondition[]): string =>
  conditions.map(formatCondition).join(' AND ')

const PRIORITY_LABELS: Record<number, string> = {
  0: 'Low',
  1: 'Normal',
  2: 'High',
}

// ============================================================================
// Rule row
// ============================================================================

function RuleRow({ rule }: { rule: DeductionRule }) {
  const queryClient = useQueryClient()

  const toggleMutation = useMutation({
    mutationFn: () => updateDeductionRule(rule.id, { enabled: !rule.enabled }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['deductionRules'] })
      const previous = queryClient.getQueryData<DeductionRule[]>(['deductionRules'])
      queryClient.setQueryData<DeductionRule[]>(['deductionRules'], (old) =>
        old?.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['deductionRules'], context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['deductionRules'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteDeductionRule(rule.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deductionRules'] })
    },
  })

  return (
    <div class="rule-row">
      <a href={`/deduction-rules/${rule.id}`} class="rule-info">
        <span class="rule-name">{rule.name}</span>
        <span class="rule-conditions">{formatConditions(rule.conditions)}</span>
        <span class="rule-output">{rule.output_activity_type}</span>
        <span class={`rule-priority priority-${rule.priority}`}>
          {PRIORITY_LABELS[rule.priority] ?? rule.priority}
        </span>
      </a>
      <div class="rule-actions">
        <label class="rule-toggle">
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={() => toggleMutation.mutate()}
            disabled={toggleMutation.isPending}
          />
          <span class="rule-toggle-label">Enabled</span>
        </label>
        <ConfirmButton
          label="Delete"
          confirmMessage={`Delete rule "${rule.name}"?`}
          onConfirm={() => deleteMutation.mutate()}
          isPending={deleteMutation.isPending}
          pendingLabel="Deleting..."
        />
      </div>
    </div>
  )
}

// ============================================================================
// Main page
// ============================================================================

export function DeductionRules() {
  const isLoggedIn = auth.value.token
  const { route } = useLocation()
  const queryClient = useQueryClient()
  const [evalResult, setEvalResult] = useState<{
    rules_evaluated: number
    activities_created: number
  } | null>(null)

  const { data: rules = [], isLoading } = useQuery({
    queryFn: fetchDeductionRules,
    queryKey: ['deductionRules'],
  })

  const evalMutation = useMutation({
    mutationFn: evaluateDeductionRules,
    onSuccess: (result) => {
      setEvalResult(result)
      queryClient.invalidateQueries({ queryKey: ['activities'] })
    },
  })

  if (!isLoggedIn) {
    return (
      <div class="data-sources-page">
        <p>Please log in to manage deduction rules.</p>
      </div>
    )
  }

  return (
    <div class="data-sources-page">
      <div class="page-header">
        <h1>Deduction Rules</h1>
        <p class="page-subtitle">
          Rules that automatically create activities by combining conditions on existing data.
        </p>
      </div>

      <div class="rules-header">
        <button type="button" class="note-action-btn" onClick={() => route('/deduction-rules/new')}>
          Add Rule
        </button>
        <button
          type="button"
          class="note-action-btn"
          onClick={() => evalMutation.mutate()}
          disabled={evalMutation.isPending}
        >
          {evalMutation.isPending ? 'Evaluating...' : 'Evaluate All'}
        </button>
      </div>

      {evalResult && (
        <div class="eval-result">
          Evaluated {evalResult.rules_evaluated} rules, created {evalResult.activities_created} activities.
        </div>
      )}

      {evalMutation.isError && <p class="rule-error">{(evalMutation.error as Error).message}</p>}

      {isLoading ? (
        <p class="loading">Loading deduction rules...</p>
      ) : rules.length === 0 ? (
        <p class="rules-empty">No deduction rules yet. Create one to get started.</p>
      ) : (
        <div class="rules-list">
          {rules.map((rule) => (
            <RuleRow key={rule.id} rule={rule} />
          ))}
        </div>
      )}
    </div>
  )
}
