import type { AdminUserPlan } from '@aurboda/api-spec'

import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { type SaveStatus, SaveStatusIndicator } from '../../components/SaveStatusIndicator'
import { apiErrorMessage, updateAdminUserPlan } from '../../state/api'
import { type PlanForm, planForm, planLabel, planUpdateBody } from './admin-users-utils'

export function PlanEditor({ username, plan }: { username: string; plan: AdminUserPlan }) {
  const queryClient = useQueryClient()
  const [stored, setStored] = useState(plan)
  const [form, setForm] = useState(() => planForm(plan))
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })
  const label = planLabel(stored, (iso) => (iso ? new Date(iso).toLocaleDateString() : ''))

  const set = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  const save = async (e: Event) => {
    e.preventDefault()
    setSaveStatus({ status: 'saving' })
    try {
      const updated = await updateAdminUserPlan(username, planUpdateBody(stored, form))
      setStored(updated)
      setForm(planForm(updated))
      void queryClient.invalidateQueries({ queryKey: ['adminUserUsage', username] })
      void queryClient.invalidateQueries({ queryKey: ['adminUsers'] })
      setSaveStatus({ status: 'saved', time: new Date() })
    } catch (err) {
      setSaveStatus({ error: apiErrorMessage(err, 'Failed to save'), status: 'error' })
    }
  }

  return (
    <section class="au-section">
      <h2>
        Plan <SaveStatusIndicator state={saveStatus} />
      </h2>
      <p class="au-muted">
        Now: <span class={`au-plan au-plan-${label.tone}`}>{label.text}</span>. Record a payment by setting
        the paid-until date; on a trial that switches the plan to paid.
      </p>
      <form class="au-plan-form" onSubmit={save}>
        <label>
          Plan
          <select
            value={form.plan}
            onChange={(e) => set('plan', (e.target as HTMLSelectElement).value as PlanForm['plan'])}
          >
            {form.plan === '' && <option value="">none</option>}
            <option value="exempt">exempt</option>
            <option value="trial">trial</option>
            <option value="paid">paid</option>
          </select>
        </label>
        <label>
          Paid until
          <input
            type="date"
            value={form.paid_until}
            onInput={(e) => set('paid_until', (e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          Trial ends
          <input
            type="date"
            value={form.trial_ends_at}
            onInput={(e) => set('trial_ends_at', (e.target as HTMLInputElement).value)}
          />
        </label>
        <label class="au-plan-note">
          Note
          <input
            type="text"
            maxLength={1000}
            placeholder="e.g. pays via Patreon"
            value={form.plan_note}
            onInput={(e) => set('plan_note', (e.target as HTMLInputElement).value)}
          />
        </label>
        <button type="submit" disabled={saveStatus.status === 'saving'}>
          Save
        </button>
      </form>
    </section>
  )
}
