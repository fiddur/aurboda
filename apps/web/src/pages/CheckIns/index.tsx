import type { CheckIn, CheckInForm, CheckInTemplate, DueSlot } from '@aurboda/api-spec'

import { useMutation, useQuery } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useState } from 'preact/hooks'

import {
  addCheckInForm,
  fetchCheckInForms,
  fetchCheckIns,
  fetchCheckInTemplates,
  fetchDue,
  restoreCheckIn,
  restoreCheckInForm,
  updateCheckInForm,
} from '../../state/api'
import { auth } from '../../state/auth'
import {
  answeredLine,
  checkInScheduleLine,
  fillHref,
  latestByForm,
  slotLabel,
  whenLine,
} from './check-in-view'
import { checkInKeys, useRefreshCheckIns } from './queries'
import { UndoBar } from './UndoBar'
import './style.css'

const RECENT_LIMIT = 200

function DueToday({ slots }: { slots: DueSlot[] }) {
  if (slots.length === 0) return null
  return (
    <section class="checkins-section">
      <h2>Due today</h2>
      <ul class="checkins-card checkins-list">
        {slots.map((slot) => (
          <li key={`${slot.form_id}-${slot.scheduled_for}`} class={`checkin-slot state-${slot.state}`}>
            <span class="checkin-slot-time">{slot.time}</span>
            <span class="checkin-slot-main">
              <strong>{slot.form_name}</strong>
              <span class={`checkin-slot-state state-${slot.state}`}>{slotLabel(slot)}</span>
            </span>
            {slot.state === 'due' && (
              <a class="btn-primary checkin-fill" href={fillHref(slot.form_id, slot.scheduled_for)}>
                Fill in
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function FormRow({ form, latest, now }: { form: CheckInForm; latest: CheckIn | undefined; now: Date }) {
  const refresh = useRefreshCheckIns()
  const archive = useMutation({
    mutationFn: (archived: boolean) => updateCheckInForm(form.id, { archived }),
    onSettled: refresh,
  })
  return (
    <li class={`checkin-form-row${form.archived ? ' archived' : ''}`}>
      <div class="checkin-form-main">
        <strong class="checkin-form-name">{form.name}</strong>
        {form.description && <span class="checkin-form-description">{form.description}</span>}
        <span class="checkin-form-schedule">
          {form.schedule ? checkInScheduleLine(form.schedule) : 'No schedule: fill it in when you like'}
        </span>
        <span class="checkin-form-latest">{latest ? answeredLine(latest, now) : 'Not answered yet'}</span>
        {archive.error && (
          <span class="checkin-error" role="alert">
            {archive.error.message}
          </span>
        )}
      </div>
      <div class="checkin-form-actions">
        {!form.archived && (
          <a class="btn-primary" href={fillHref(form.id)}>
            Fill in
          </a>
        )}
        <a class="btn-secondary" href={`/check-ins/${form.id}/edit`}>
          Edit
        </a>
        <button
          type="button"
          class="btn-secondary"
          disabled={archive.isPending}
          onClick={() => archive.mutate(!form.archived)}
        >
          {form.archived ? 'Unarchive' : 'Archive'}
        </button>
      </div>
    </li>
  )
}

interface FormsSectionProps {
  forms: CheckInForm[] | undefined
  isLoading: boolean
  failed: boolean
  latest: Map<string, CheckIn>
  now: Date
}

function FormsSection({ forms, isLoading, failed, latest, now }: FormsSectionProps) {
  const [showArchived, setShowArchived] = useState(false)
  if (isLoading) return <p class="checkins-muted">Loading…</p>
  if (failed) return <p class="checkins-muted">Couldn’t load your check-ins. Please try again.</p>
  const all = forms ?? []
  if (all.length === 0) {
    return (
      <div class="checkins-empty">
        <p>
          A check-in is a short set of questions you answer now and then, like how rested you feel each
          morning. Numeric answers become metrics you can chart and analyse with the rest of your data.
        </p>
      </div>
    )
  }
  const live = all.filter((form) => !form.archived)
  const archived = all.filter((form) => form.archived)
  return (
    <section class="checkins-section">
      <div class="checkins-section-header">
        <h2>Your forms</h2>
        {archived.length > 0 && (
          <label class="checkin-switch">
            <input
              type="checkbox"
              role="switch"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.currentTarget.checked)}
            />
            <span>Show archived ({archived.length})</span>
          </label>
        )}
      </div>
      {live.length > 0 && (
        <ul class="checkins-card checkins-list">
          {live.map((form) => (
            <FormRow key={form.id} form={form} latest={latest.get(form.id)} now={now} />
          ))}
        </ul>
      )}
      {showArchived && archived.length > 0 && (
        <ul class="checkins-card checkins-list checkins-archived">
          {archived.map((form) => (
            <FormRow key={form.id} form={form} latest={latest.get(form.id)} now={now} />
          ))}
        </ul>
      )}
    </section>
  )
}

function Templates({ onError }: { onError: (message: string) => void }) {
  const { route } = useLocation()
  const refresh = useRefreshCheckIns()
  const { data: templates } = useQuery({ queryFn: fetchCheckInTemplates, queryKey: checkInKeys.templates })
  const copy = useMutation({
    mutationFn: (template: CheckInTemplate) => addCheckInForm({ notify: true, template: template.id }),
    onError: (error) => onError(error.message),
    onSuccess: async (form) => {
      await refresh()
      route(`/check-ins/${form.id}/edit`)
    },
  })
  if (!templates?.length) return null
  return (
    <details class="checkins-card checkins-templates">
      <summary>Start from a template</summary>
      <ul class="checkins-list">
        {templates.map((template) => (
          <li key={template.id} class="checkin-template">
            <div class="checkin-form-main">
              <strong>{template.name}</strong>
              <span class="checkin-form-description">{template.description}</span>
              <span class="checkin-template-source">
                {template.source}
                {template.licence && ` · ${template.licence}`}
              </span>
            </div>
            <button
              type="button"
              class="btn-secondary"
              disabled={copy.isPending}
              onClick={() => copy.mutate(template)}
            >
              {copy.isPending && copy.variables?.id === template.id ? 'Adding…' : 'Use this'}
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}

function RecentlyDeleted({ now }: { now: Date }) {
  const refresh = useRefreshCheckIns()
  const forms = useQuery({ queryFn: () => fetchCheckInForms(true), queryKey: checkInKeys.deletedForms })
  const checkIns = useQuery({
    queryFn: () => fetchCheckIns({ deleted: true, limit: 50 }),
    queryKey: checkInKeys.deletedCheckIns,
  })
  const restoreForm = useMutation({ mutationFn: restoreCheckInForm, onSettled: refresh })
  const restore = useMutation({ mutationFn: restoreCheckIn, onSettled: refresh })
  const deletedForms = forms.data ?? []
  const deletedCheckIns = checkIns.data?.check_ins ?? []
  if (deletedForms.length === 0 && deletedCheckIns.length === 0) return null
  const error = restoreForm.error ?? restore.error
  return (
    <details class="checkins-card checkins-deleted">
      <summary>Recently deleted ({deletedForms.length + deletedCheckIns.length})</summary>
      <p class="checkins-muted">Deleted forms and check-ins can be restored for 30 days.</p>
      {error && (
        <p class="checkin-error" role="alert">
          {error.message}
        </p>
      )}
      <ul class="checkins-list">
        {deletedForms.map((form) => (
          <li key={form.id} class="checkin-deleted-row">
            <span>
              <strong>{form.name}</strong> <span class="checkins-muted">(form)</span>
            </span>
            <button type="button" class="btn-secondary" onClick={() => restoreForm.mutate(form.id)}>
              Restore
            </button>
          </li>
        ))}
        {deletedCheckIns.map((checkIn) => (
          <li key={checkIn.id} class="checkin-deleted-row">
            <span>
              <strong>{checkIn.form_name}</strong>{' '}
              <span class="checkins-muted">answered {whenLine(new Date(checkIn.answered_at), now)}</span>
            </span>
            <button type="button" class="btn-secondary" onClick={() => restore.mutate(checkIn.id)}>
              Restore
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}

export function CheckIns() {
  const isLoggedIn = Boolean(auth.value.token)
  const { query, route } = useLocation()
  const refresh = useRefreshCheckIns()
  const [actionError, setActionError] = useState<string | null>(null)
  const forms = useQuery({
    enabled: isLoggedIn,
    queryFn: () => fetchCheckInForms(),
    queryKey: checkInKeys.forms,
  })
  const due = useQuery({ enabled: isLoggedIn, queryFn: fetchDue, queryKey: checkInKeys.due })
  const recent = useQuery({
    enabled: isLoggedIn,
    queryFn: () => fetchCheckIns({ limit: RECENT_LIMIT }),
    queryKey: checkInKeys.recent,
  })

  if (!isLoggedIn) {
    return (
      <div class="checkins-page">
        <h1>Check-ins</h1>
        <p>Please log in to see your check-ins.</p>
      </div>
    )
  }

  const now = new Date()
  const latest = latestByForm(recent.data?.check_ins ?? [])
  const deletedId = query.deleted
  const closeUndo = () => route('/check-ins', true)

  return (
    <div class="checkins-page">
      <div class="checkins-header">
        <h1>Check-ins</h1>
        <a class="btn-primary" href="/check-ins/new">
          New form
        </a>
      </div>
      {deletedId && (
        <UndoBar
          message="Form deleted."
          onUndo={async () => {
            await restoreCheckInForm(deletedId)
            await refresh()
          }}
          onClose={closeUndo}
        />
      )}
      {actionError && (
        <p class="checkin-error" role="alert">
          {actionError}
        </p>
      )}

      <DueToday slots={due.data?.slots ?? []} />

      <FormsSection
        forms={forms.data}
        isLoading={forms.isLoading}
        failed={Boolean(forms.error)}
        latest={latest}
        now={now}
      />

      <Templates onError={setActionError} />
      <RecentlyDeleted now={now} />
    </div>
  )
}
