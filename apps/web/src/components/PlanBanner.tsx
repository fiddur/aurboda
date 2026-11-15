import { useQuery } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { isPlayStoreBuild } from '../embed'
import { fetchMyPlan } from '../state/api'
import { auth } from '../state/auth'
import { planBanner, planBannerAction } from '../utils/plan'
import './PlanBanner.css'

const DISMISS_KEY = 'aurboda_plan_banner_dismissed'

const readDismissed = (): boolean => {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

/** App-wide notice when the plan ends soon, is in its grace period or has made the account read-only. */
export function PlanBanner() {
  const isLoggedIn = !!auth.value.token
  const [dismissed, setDismissed] = useState(readDismissed)
  const { data: plan } = useQuery({
    enabled: isLoggedIn,
    queryFn: fetchMyPlan,
    queryKey: ['myPlan'],
    staleTime: 5 * 60_000,
  })

  const banner = isLoggedIn ? planBanner(plan) : null
  if (!banner || (banner.dismissable && dismissed)) return null

  const action = planBannerAction(plan, banner.tone, isPlayStoreBuild())
  const dismiss = () => {
    setDismissed(true)
    try {
      sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {}
  }

  return (
    <div class={`plan-banner plan-banner-${banner.tone}`} role="status">
      <p class="plan-banner-text">{banner.text}</p>
      {action && (
        <a href={action.href} target="_blank" rel="noopener noreferrer">
          {action.label}
        </a>
      )}
      <a href="/settings#plan">Plan details</a>
      {banner.dismissable && (
        <button type="button" class="plan-banner-dismiss" onClick={dismiss}>
          Dismiss
        </button>
      )}
    </div>
  )
}
