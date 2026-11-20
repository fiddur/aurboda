import { useQuery } from '@tanstack/react-query'

import { fillHref, openSlots, showsDueCard, slotLabel } from '../pages/CheckIns/check-in-view'
import { checkInKeys } from '../pages/CheckIns/queries'
import { fetchCheckInForms, fetchDue } from '../state/api'
import { auth } from '../state/auth'
import { isPageHidden } from './nav-links'
import { useHiddenPages } from './useHiddenPages'
import './DueTodayCard.css'

/** Home's "Due today" card: today's open check-in slots, for a user with a scheduled form. */
export function DueTodayCard() {
  const hidden = isPageHidden('/check-ins', useHiddenPages())
  const loggedIn = Boolean(auth.value.token)
  const forms = useQuery({
    enabled: loggedIn && !hidden,
    queryFn: () => fetchCheckInForms(),
    queryKey: checkInKeys.forms,
  })
  const shown = showsDueCard(forms.data ?? [], hidden)
  const due = useQuery({ enabled: loggedIn && shown, queryFn: fetchDue, queryKey: checkInKeys.due })
  if (!shown || !due.data) return null
  const open = openSlots(due.data.slots)
  return (
    <section class="due-today" aria-labelledby="due-today-title">
      <div class="due-today-header">
        <h2 id="due-today-title">Due today</h2>
        <a href="/check-ins">All check-ins</a>
      </div>
      {open.length === 0 ? (
        <p class="due-today-empty">Nothing left to fill in today.</p>
      ) : (
        <ul class="due-today-list">
          {open.map((slot) => (
            <li key={`${slot.form_id}-${slot.scheduled_for}`}>
              <span class="due-today-time">{slot.time}</span>
              <span class="due-today-main">
                <strong>{slot.form_name}</strong>
                <span class={`due-today-state state-${slot.state}`}>{slotLabel(slot)}</span>
              </span>
              <a
                class={slot.state === 'due' ? 'btn-primary' : 'btn-secondary'}
                href={fillHref(slot.form_id, slot.scheduled_for)}
              >
                Fill in
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
