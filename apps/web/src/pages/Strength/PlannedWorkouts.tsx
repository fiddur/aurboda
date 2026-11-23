import type { MuscleRecovery, StrengthPlan } from '@aurboda/api-spec'

import {
  isOverdue,
  isPrimaryStart,
  lastDoneLabel,
  planDayLabel,
  plansForToday,
  planSummary,
  readinessLine,
  splitPlans,
} from './planModel'
import { exerciseNames } from './sessionModel'
import { exerciseListLabel } from './startModel'

const planEditUrl = (id: string): string => `/strength/plan/${encodeURIComponent(id)}`

const planStartUrl = (id: string): string => `/strength/live?plan=${encodeURIComponent(id)}`

const PlanCard = ({
  plan,
  now,
  recovery,
  onStart,
}: {
  plan: StrengthPlan
  now: Date
  recovery: MuscleRecovery | null | undefined
  onStart: (url: string) => void
}) => {
  const day = planDayLabel(plan.planned_for, now)
  const names = exerciseListLabel(exerciseNames(plan.sets))
  const readiness = readinessLine(plan.muscle_groups, recovery, now)
  return (
    <li class="strength-card strength-plan">
      <div class="strength-repeat-text">
        <span class="strength-plan-name">
          {plan.name}
          {' · '}
          {day ? (
            <span class={isOverdue(plan.planned_for, now) ? 'strength-plan-overdue' : undefined}>{day}</span>
          ) : (
            <span class="strength-muted">{lastDoneLabel(plan.sessions, now)}</span>
          )}
        </span>
        <span class="strength-muted">{planSummary(plan)}</span>
        {names && <span class="strength-muted">{names}</span>}
        {readiness && <span class="strength-plan-readiness">{readiness}</span>}
        {plan.note && <span class="strength-muted strength-plan-note">{plan.note}</span>}
      </div>
      <div class="strength-row-actions">
        <button
          type="button"
          class={isPrimaryStart(plan.planned_for, now) ? 'btn-primary' : 'btn-secondary'}
          onClick={() => onStart(planStartUrl(plan.id))}
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

const PlanLink = () => <a href="/strength/plan/new">Plan a workout</a>

const SectionHeading = ({ title, planLink }: { title: string; planLink: boolean }) => (
  <div class="strength-section-heading">
    <h2>{title}</h2>
    {planLink && <PlanLink />}
  </div>
)

export const PlannedWorkouts = ({
  plans,
  recovery,
  onStart,
}: {
  plans: StrengthPlan[]
  recovery: MuscleRecovery | null | undefined
  onStart: (url: string) => void
}) => {
  const now = new Date()
  const { dated, saved } = splitPlans(plans)
  const list = (items: StrengthPlan[]) => (
    <ul class="strength-repeat-list">
      {items.map((plan) => (
        <PlanCard key={plan.id} plan={plan} now={now} recovery={recovery} onStart={onStart} />
      ))}
    </ul>
  )
  return (
    <>
      {dated.length > 0 && (
        <section class="strength-section">
          <SectionHeading title="Planned" planLink />
          {list(dated)}
        </section>
      )}
      {saved.length > 0 && (
        <section class="strength-section">
          <SectionHeading title="Saved workouts" planLink={dated.length === 0} />
          {list(saved)}
        </section>
      )}
      <section class="strength-section">
        <h2>Without a plan</h2>
        <div class="strength-row-actions">
          <button type="button" class="btn-secondary" onClick={() => onStart('/strength/live')}>
            Start an empty session
          </button>
          <a class="btn-secondary" href="/strength/log">
            Log a past session
          </a>
        </div>
      </section>
    </>
  )
}

export const NoPlans = ({ state }: { state: 'loading' | 'error' | 'empty' }) => (
  <section class="strength-section">
    <SectionHeading title="Planned and saved workouts" planLink={false} />
    {state === 'error' && <p class="strength-error">Your planned workouts could not be loaded.</p>}
    {state === 'empty' && (
      <p class="strength-muted">
        Nothing planned or saved yet. Plan a workout for a day, save one you repeat, or let an assistant plan
        the next one from your recovery and history.
      </p>
    )}
    <p>
      <PlanLink />
    </p>
  </section>
)

export const PlannedToday = ({
  plans,
  recovery,
}: {
  plans: StrengthPlan[] | undefined
  recovery: MuscleRecovery | null | undefined
}) => {
  const now = new Date()
  return (
    <>
      {plansForToday(plans ?? [], now).map((plan) => {
        const readiness = readinessLine(plan.muscle_groups, recovery, now)
        return (
          <section key={plan.id} class="strength-card">
            <span class="strength-muscles-score-label">Planned today</span>
            <span class="strength-plan-name">{plan.name}</span>
            <span class="strength-muted">
              {readiness ? `${planSummary(plan)}. ${readiness}.` : `${planSummary(plan)}.`}
            </span>
            <div class="strength-row-actions">
              <a class="btn-primary" href={planStartUrl(plan.id)}>
                Start
              </a>
            </div>
          </section>
        )
      })}
    </>
  )
}
