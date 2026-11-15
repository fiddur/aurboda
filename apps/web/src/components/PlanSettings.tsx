import { useQuery } from '@tanstack/react-query'

import { isPlayStoreBuild } from '../embed'
import { fetchMyPlan } from '../state/api'
import { planPayment, planSummary } from '../utils/plan'
import { SettingsSection } from './SettingsSection'

/** The user's own plan; shown only when the server bills accounts. */
export function PlanSettings() {
  const { data: plan } = useQuery({ queryFn: fetchMyPlan, queryKey: ['myPlan'], staleTime: 5 * 60_000 })
  if (!plan?.billing_enabled) return null

  const billed = plan.plan === 'trial' || plan.plan === 'paid'
  const { payment_url, price_text } = planPayment(plan, isPlayStoreBuild())
  return (
    <div id="plan">
      <SettingsSection title="Plan">
        <p class="section-description">{planSummary(plan)}</p>
        {price_text && <p class="field-description">Price: {price_text}</p>}
        {billed && plan.state !== 'active' && plan.state !== 'trial' && (
          <p class="field-description">
            A read-only account can still be browsed, exported and deleted; nothing is deleted automatically.
          </p>
        )}
        {payment_url && (
          <a
            class="connect-button plan-pay-link"
            href={payment_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Pay for Aurboda
          </a>
        )}
      </SettingsSection>
    </div>
  )
}
