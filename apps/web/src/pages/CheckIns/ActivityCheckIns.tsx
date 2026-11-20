import { useQuery } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { fetchCheckInForms, fetchCheckIns } from '../../state/api'
import { activityFillHref, whenLine } from './check-in-view'
import { checkInKeys } from './queries'
import { answersLine } from './routines'
import './style.css'

/** On an activity's page: the check-ins tied to it, and "Add check-in" to fill in a form tied to it. */
export function ActivityCheckIns({ activityId }: { activityId: string }) {
  const [formId, setFormId] = useState('')
  const forms = useQuery({ queryFn: () => fetchCheckInForms(), queryKey: checkInKeys.forms })
  const tied = useQuery({
    queryFn: () => fetchCheckIns({ entity_id: activityId, entity_type: 'activity', limit: 50 }),
    queryKey: checkInKeys.byActivity(activityId),
  })
  const live = (forms.data ?? []).filter((form) => !form.archived)
  const checkIns = tied.data?.check_ins ?? []
  if (live.length === 0 && checkIns.length === 0) return null
  const now = new Date()
  return (
    <section class="checkin-activity-section">
      <h3>Check-ins</h3>
      {checkIns.length > 0 && (
        <ul class="checkins-card checkins-list">
          {checkIns.map((checkIn) => (
            <li key={checkIn.id} class="checkin-activity-row">
              <a href={`/check-ins/${encodeURIComponent(checkIn.form_id)}`}>
                <strong>{checkIn.form_name}</strong>
              </a>{' '}
              <span class="checkins-muted">
                {checkIn.status === 'skipped' ? 'skipped' : 'answered'}{' '}
                {whenLine(new Date(checkIn.answered_at), now)}
              </span>
              {checkIn.status === 'answered' && (
                <span class="checkin-activity-answers">
                  {answersLine(checkIn.questions, checkIn.answers)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {live.length > 0 && (
        <div class="checkin-activity-add">
          <select
            aria-label="Check-in form"
            value={formId}
            onChange={(e) => setFormId(e.currentTarget.value)}
          >
            <option value="">Pick a form…</option>
            {live.map((form) => (
              <option key={form.id} value={form.id}>
                {form.name}
              </option>
            ))}
          </select>
          {formId ? (
            <a class="btn-secondary" href={activityFillHref(formId, activityId)}>
              Add check-in
            </a>
          ) : (
            <button type="button" class="btn-secondary" disabled>
              Add check-in
            </button>
          )}
        </div>
      )}
    </section>
  )
}
