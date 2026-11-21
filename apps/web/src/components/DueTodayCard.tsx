import { useQuery } from '@tanstack/react-query'

import { dueCardActions, fillHref, openSlots, showsDueCard, slotLabel } from '../pages/CheckIns/check-in-view'
import { checkInKeys } from '../pages/CheckIns/queries'
import { type QuickAction, sameAction, useQuickCheckIn } from '../pages/CheckIns/quick'
import { fetchCheckInForms, fetchDue } from '../state/api'
import { auth } from '../state/auth'
import { isPageHidden } from './nav-links'
import { useHiddenPages } from './useHiddenPages'
import './DueTodayCard.css'

/**
 * Home's "Due today" card: today's open check-in slots, for a user with a scheduled form. A routine's
 * due slot is Done or skipped in place, with Undo; any other slot links to filling it in.
 */
export function DueTodayCard() {
  const hidden = isPageHidden('/check-ins', useHiddenPages())
  const loggedIn = Boolean(auth.value.token)
  const { feedback, quick } = useQuickCheckIn()
  const forms = useQuery({
    enabled: loggedIn && !hidden,
    queryFn: () => fetchCheckInForms(),
    queryKey: checkInKeys.forms,
  })
  const shown = showsDueCard(forms.data ?? [], hidden)
  const due = useQuery({ enabled: loggedIn && shown, queryFn: fetchDue, queryKey: checkInKeys.due })
  if (!shown || !due.data) return null
  const open = openSlots(due.data.slots)
  const routines = new Map(
    (forms.data ?? []).filter((form) => form.is_routine && !form.archived).map((form) => [form.id, form]),
  )
  return (
    <section class="due-today" aria-labelledby="due-today-title">
      <div class="due-today-header">
        <h2 id="due-today-title">Due today</h2>
        <a href="/check-ins">All check-ins</a>
      </div>
      {feedback}
      {open.length === 0 ? (
        <p class="due-today-empty">Nothing left to fill in today.</p>
      ) : (
        <ul class="due-today-list">
          {open.map((slot) => {
            const routine = routines.get(slot.form_id)
            const actions = dueCardActions(slot, routine !== undefined)
            const done: QuickAction | undefined = routine && {
              form: routine,
              kind: 'confirm',
              slot: slot.scheduled_for,
            }
            const skip: QuickAction = { form_id: slot.form_id, kind: 'skip', slot: slot.scheduled_for }
            return (
              <li key={`${slot.form_id}-${slot.scheduled_for}`}>
                <span class="due-today-time">{slot.time}</span>
                <span class="due-today-main">
                  <strong>{slot.form_name}</strong>
                  <span class={`due-today-state state-${slot.state}`}>{slotLabel(slot)}</span>
                </span>
                <span class="due-today-actions">
                  {actions.confirm && done && (
                    <button
                      type="button"
                      class="btn-primary"
                      disabled={quick.pending !== undefined}
                      onClick={() => quick.run(done)}
                    >
                      {sameAction(quick.pending, done) ? 'Saving…' : 'Done'}
                    </button>
                  )}
                  {actions.skip && (
                    <button
                      type="button"
                      class="btn-secondary"
                      disabled={quick.pending !== undefined}
                      onClick={() => quick.run(skip)}
                    >
                      {sameAction(quick.pending, skip) ? 'Skipping…' : 'Skip'}
                    </button>
                  )}
                  {actions.fill && (
                    <a
                      class={slot.state === 'due' ? 'btn-primary' : 'btn-secondary'}
                      href={fillHref(slot.form_id, slot.scheduled_for)}
                    >
                      Fill in
                    </a>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
