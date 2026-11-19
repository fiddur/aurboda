import type { Reminder, RemindersResponse } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { ConfirmButton } from '../../components/ConfirmButton'
import { addReminder, deleteReminder, fetchReminders, updateReminder } from '../../state/api'
import { auth } from '../../state/auth'
import {
  emptyForm,
  formError,
  formFromReminder,
  formToAddBody,
  formToUpdateBody,
  NO_PAGE,
  OTHER_PAGE,
  PAGE_OPTIONS,
  pageLabel,
  type ReminderForm,
  roundTime,
  scheduleLine,
  toggleDay,
  WEEKDAYS,
} from './reminder-form'
import './style.css'

const REMINDERS_KEY = ['reminders'] as const

/** `null` closed, `'new'` adding, otherwise the id being edited. */
type Editing = null | 'new' | string

interface FormProps {
  initial: ReminderForm
  timezone: string | undefined
  submitLabel: string
  onSubmit: (form: ReminderForm) => Promise<unknown>
  onCancel: () => void
}

function ReminderEditor({ initial, timezone, submitLabel, onSubmit, onCancel }: FormProps) {
  const [form, setForm] = useState<ReminderForm>(initial)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<ReminderForm>) => setForm((current) => ({ ...current, ...patch }))

  const submit = async (e: Event) => {
    e.preventDefault()
    const problem = formError(form)
    if (problem) return setError(problem)
    setError(null)
    setSaving(true)
    try {
      await onSubmit(form)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save the reminder. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form class="reminder-form" onSubmit={submit} noValidate>
      <label class="reminder-field">
        <span>Name</span>
        <input
          type="text"
          value={form.title}
          maxLength={120}
          required
          placeholder="Evening questionnaire"
          onInput={(e) => set({ title: e.currentTarget.value })}
        />
      </label>
      <label class="reminder-field">
        <span>
          Text <small>(optional)</small>
        </span>
        <textarea
          rows={2}
          value={form.body}
          maxLength={500}
          placeholder="Shown under the name in the notification"
          onInput={(e) => set({ body: e.currentTarget.value })}
        />
      </label>
      <label class="reminder-field reminder-time">
        <span>Time</span>
        <input
          type="time"
          step={300}
          value={form.time}
          required
          onInput={(e) => set({ time: e.currentTarget.value })}
          onBlur={(e) => {
            const rounded = roundTime(e.currentTarget.value)
            if (rounded) set({ time: rounded })
          }}
        />
      </label>
      <fieldset class="reminder-field reminder-days">
        <legend>Days</legend>
        <div class="reminder-day-toggles">
          {WEEKDAYS.map(({ day, short }) => (
            <button
              key={day}
              type="button"
              class={`reminder-day${form.weekdays.includes(day) ? ' active' : ''}`}
              aria-pressed={form.weekdays.includes(day)}
              onClick={() => set({ weekdays: toggleDay(form.weekdays, day) })}
            >
              {short}
            </button>
          ))}
        </div>
      </fieldset>
      <label class="reminder-field">
        <span>Page to open</span>
        <select value={form.page} onChange={(e) => set({ page: e.currentTarget.value })}>
          <option value={NO_PAGE}>No page</option>
          {PAGE_OPTIONS.map((option) => (
            <option key={option.href} value={option.href}>
              {option.label}
            </option>
          ))}
          <option value={OTHER_PAGE}>Other path</option>
        </select>
      </label>
      {form.page === OTHER_PAGE && (
        <label class="reminder-field">
          <span>Path</span>
          <input
            type="text"
            value={form.otherPath}
            maxLength={500}
            placeholder="/reports"
            onInput={(e) => set({ otherPath: e.currentTarget.value })}
          />
        </label>
      )}
      {error && (
        <p class="reminder-error" role="alert">
          {error}
        </p>
      )}
      <div class="reminder-form-actions">
        <button type="submit" class="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        <button type="button" class="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p class="reminder-note">
        Times follow your time zone{timezone ? ` (${timezone})` : ''}. Change it in{' '}
        <a href="/settings#time-zone">Settings</a>.
      </p>
    </form>
  )
}

interface RowProps {
  reminder: Reminder
  onEdit: () => void
}

function ReminderRow({ reminder, onEdit }: RowProps) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: REMINDERS_KEY })
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => updateReminder(reminder.id, { enabled }),
    onMutate: (enabled) =>
      queryClient.setQueryData<RemindersResponse>(
        REMINDERS_KEY,
        (data) =>
          data && {
            ...data,
            reminders: data.reminders.map((r) => (r.id === reminder.id ? { ...r, enabled } : r)),
          },
      ),
    onSettled: refresh,
  })
  const remove = useMutation({ mutationFn: () => deleteReminder(reminder.id), onSettled: refresh })

  return (
    <li class={`reminder-row${reminder.enabled ? '' : ' off'}`}>
      <div class="reminder-main">
        <strong class="reminder-title">{reminder.title}</strong>
        <span class="reminder-schedule">{scheduleLine(reminder.time_of_day, reminder.weekdays)}</span>
        {reminder.body && <span class="reminder-body">{reminder.body}</span>}
        {reminder.link && <span class="reminder-link">Opens {pageLabel(reminder.link)}</span>}
        {(toggle.error ?? remove.error) && (
          <span class="reminder-error" role="alert">
            {(toggle.error ?? remove.error)?.message}
          </span>
        )}
      </div>
      <div class="reminder-actions">
        <label class="reminder-switch">
          <input
            type="checkbox"
            role="switch"
            checked={reminder.enabled}
            disabled={toggle.isPending}
            aria-label={`${reminder.title}: ${reminder.enabled ? 'on' : 'off'}`}
            onChange={(e) => toggle.mutate(e.currentTarget.checked)}
          />
          <span>{reminder.enabled ? 'On' : 'Off'}</span>
        </label>
        <button type="button" class="btn-secondary" onClick={onEdit}>
          Edit
        </button>
        <ConfirmButton
          label="Delete"
          confirmMessage={`Delete "${reminder.title}"?`}
          onConfirm={() => remove.mutate()}
          isPending={remove.isPending}
          pendingLabel="Deleting…"
        />
      </div>
    </li>
  )
}

export function Reminders() {
  const isLoggedIn = Boolean(auth.value.token)
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Editing>(null)
  const { data, isLoading, error } = useQuery({
    enabled: isLoggedIn,
    queryFn: fetchReminders,
    queryKey: REMINDERS_KEY,
  })

  if (!isLoggedIn) {
    return (
      <div class="reminders-page">
        <h1>Reminders</h1>
        <p>Please log in to see your reminders.</p>
      </div>
    )
  }

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: REMINDERS_KEY })
    setEditing(null)
  }
  const reminders = data?.reminders ?? []
  const editingReminder = reminders.find((r) => r.id === editing)

  return (
    <div class="reminders-page">
      <div class="reminders-header">
        <h1>Reminders</h1>
        {editing === null && (
          <button type="button" class="btn-primary" onClick={() => setEditing('new')}>
            Add reminder
          </button>
        )}
      </div>
      <p class="reminders-intro">
        A reminder shows up under the 🛎 bell and on your phone at the time you choose.
      </p>
      {editing === 'new' && (
        <div class="reminders-card reminder-editor-card">
          <h2>New reminder</h2>
          <ReminderEditor
            initial={emptyForm()}
            timezone={data?.timezone}
            submitLabel="Add reminder"
            onSubmit={async (form) => {
              await addReminder(formToAddBody(form))
              await done()
            }}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}
      {editingReminder && (
        <div class="reminders-card reminder-editor-card">
          <h2>Edit reminder</h2>
          <ReminderEditor
            key={editingReminder.id}
            initial={formFromReminder(editingReminder)}
            timezone={data?.timezone}
            submitLabel="Save"
            onSubmit={async (form) => {
              await updateReminder(editingReminder.id, formToUpdateBody(form))
              await done()
            }}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}
      {isLoading ? (
        <p class="reminders-empty">Loading…</p>
      ) : error ? (
        <p class="reminders-empty">Couldn't load reminders. Please try again.</p>
      ) : reminders.length === 0 ? (
        editing === null && (
          <p class="reminders-empty">
            No reminders yet. Add one to get a nudge at the same time every day, or on the days you pick.
          </p>
        )
      ) : (
        <ul class="reminders-card reminders-list">
          {reminders.map((reminder) => (
            <ReminderRow key={reminder.id} reminder={reminder} onEdit={() => setEditing(reminder.id)} />
          ))}
        </ul>
      )}
    </div>
  )
}
