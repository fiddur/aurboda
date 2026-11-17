import type { StrengthPlan } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'

import { fetchStrengthPlans } from '../../state/api'
import { isOverdue, planDayLabel, planSummary, splitPlans } from './planModel'
import { exerciseNames } from './sessionModel'
import { exerciseListLabel } from './startModel'

const planEditUrl = (id: string): string => `/strength/plan/${encodeURIComponent(id)}`

const PlanCard = ({
  plan,
  now,
  onStart,
}: {
  plan: StrengthPlan
  now: Date
  onStart: (url: string) => void
}) => {
  const day = planDayLabel(plan.planned_for, now)
  const names = exerciseListLabel(exerciseNames(plan.sets))
  return (
    <li class="strength-card strength-plan">
      <div class="strength-repeat-text">
        <span class="strength-plan-name">
          {plan.name}
          {day && (
            <>
              {' · '}
              <span class={isOverdue(plan.planned_for, now) ? 'strength-plan-overdue' : undefined}>
                {day}
              </span>
            </>
          )}
        </span>
        <span class="strength-muted">{names ? `${planSummary(plan)} · ${names}` : planSummary(plan)}</span>
        {plan.note && <span class="strength-muted strength-plan-note">{plan.note}</span>}
      </div>
      <div class="strength-row-actions">
        <button
          type="button"
          class="btn-primary"
          onClick={() => onStart(`/strength/live?plan=${encodeURIComponent(plan.id)}`)}
        >
          Start
        </button>
        <a class="btn-secondary" href={planEditUrl(plan.id)}>
          Edit
        </a>
      </div>
    </li>
  )
}

const PlanLink = () => (
  <p>
    <a href="/strength/plan/new">Plan a workout</a>
  </p>
)

export const PlannedWorkouts = ({ onStart }: { onStart: (url: string) => void }) => {
  const plans = useQuery({
    queryFn: () => fetchStrengthPlans(),
    queryKey: ['strength-plans', 'open'],
    staleTime: 60 * 1000,
  })
  if (plans.isError || !plans.data) return null
  if (plans.data.length === 0) return <PlanLink />
  const now = new Date()
  const { dated, routines } = splitPlans(plans.data)
  const list = (items: StrengthPlan[]) => (
    <ul class="strength-repeat-list">
      {items.map((plan) => (
        <PlanCard key={plan.id} plan={plan} now={now} onStart={onStart} />
      ))}
    </ul>
  )
  return (
    <section class="strength-section">
      <h2>Planned workouts</h2>
      {dated.length > 0 && list(dated)}
      {dated.length > 0 && routines.length > 0 && <h3 class="strength-plan-subheading">Routines</h3>}
      {routines.length > 0 && list(routines)}
      <PlanLink />
    </section>
  )
}
