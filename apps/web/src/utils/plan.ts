import type { AccountPlanResponse } from '@aurboda/api-spec'

export type MyPlan = Omit<AccountPlanResponse, 'success' | 'error'>

export const formatPlanDate = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString() : '')

export interface PlanBanner {
  tone: 'info' | 'warn' | 'bad'
  text: string
  /** Only the advance notice can be dismissed; grace and read-only stay until paid. */
  dismissable: boolean
}

/** The app-wide notice for a plan that is ending, in grace or read-only; null when there is nothing to say. */
export const planBanner = (plan: MyPlan | undefined, format = formatPlanDate): PlanBanner | null => {
  if (!plan?.billing_enabled) return null
  if (plan.state === 'read_only') {
    return {
      dismissable: false,
      text: 'Your account is read-only: no new data is stored until the plan is renewed. You can still browse, export and delete your data.',
      tone: 'bad',
    }
  }
  if (plan.state === 'grace') {
    return {
      dismissable: false,
      text: `Your ${plan.plan === 'trial' ? 'trial' : 'plan'} has ended. The account becomes read-only on ${format(plan.read_only_at)} unless renewed.`,
      tone: 'warn',
    }
  }
  if (plan.expiring_soon) {
    return {
      dismissable: true,
      text: `Your ${plan.plan === 'trial' ? 'free trial' : 'plan'} ends on ${format(plan.ends_at)}.`,
      tone: 'info',
    }
  }
  return null
}

/** One line on the user's own plan, for Settings. */
export const planSummary = (plan: MyPlan, format = formatPlanDate): string => {
  if (plan.plan === 'exempt' || plan.plan === null) return 'Your account is exempt from billing.'
  const until = plan.ends_at ? ` until ${format(plan.ends_at)}` : ''
  switch (plan.state) {
    case 'read_only':
      return `Your ${plan.plan === 'trial' ? 'trial' : 'plan'} has ended and the account is read-only.`
    case 'grace':
      return `Your ${plan.plan === 'trial' ? 'trial' : 'plan'} has ended; the account becomes read-only on ${format(plan.read_only_at)}.`
    case 'trial':
      return `Free trial${until}.`
    case 'active':
      return plan.plan === 'trial' ? `Free trial${until}.` : `Paid${until}.`
  }
}

export interface ServerBilling {
  billing_enabled?: boolean
  trial_days?: number
  price_text?: string | null
}

/** The signup page's note on what an account costs; null when billing is off. */
export const signupBillingLine = (status: ServerBilling | undefined): string | null => {
  if (!status?.billing_enabled) return null
  const days = status.trial_days ?? 0
  const free = days > 0 ? `Free for ${days} day${days === 1 ? '' : 's'}` : 'Paid from the start'
  const price = status.price_text?.trim()
  return days > 0 ? `${free}${price ? `, then ${price}` : ''}.` : `${free}${price ? `: ${price}` : ''}.`
}
