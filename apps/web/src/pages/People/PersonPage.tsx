import type { PersonDate, PersonDateKind, PersonDetail } from '@aurboda/api-spec'

import { PERSON_DATE_LABEL_MAX, personDateKinds } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useLocation } from 'preact-iso'
import { useState } from 'preact/hooks'

import { ConfirmButton } from '../../components/ConfirmButton'
import {
  addPersonDate,
  deletePerson,
  deletePersonDate,
  fetchPeople,
  fetchPerson,
  fetchPersonPosts,
  followActor,
  PEOPLE_KEY,
  restorePerson,
  updatePerson,
  updatePersonDate,
} from '../../state/api'
import { auth } from '../../state/auth'
import { toDisplayName } from '../../utils/displayName'
import { NotesSection } from '../EntityDetail/NotesSection'
import { TimelineCard } from '../Feed/HomeTimeline'
import { JournalEntryRefs } from '../Journal/JournalEntryRefs'
import {
  birthdayLabel,
  DATE_KIND_LABELS,
  type DateForm,
  dateToForm,
  EMPTY_DATE_FORM,
  formToDateBody,
  monthName,
  timeWithHref,
} from './people-view'
import { PersonAvatar } from './PeopleList'
import { PersonForm } from './PersonForm'
import { offerUndo, UndoBar } from './undo'

const personKey = (id: string) => [...PEOPLE_KEY, 'person', id] as const

const reminderText = (days: number | null): string =>
  days === null
    ? ''
    : days === 0
      ? 'reminder on the day'
      : `reminder ${days} ${days === 1 ? 'day' : 'days'} before`

const dateWhen = (date: Pick<PersonDate, 'day' | 'month' | 'year'>): string =>
  `${date.day} ${monthName(date.month)}${date.year === null ? '' : ` ${date.year}`}`

function DateEditor({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: DateForm
  submitLabel: string
  onSubmit: (form: DateForm) => Promise<unknown>
  onCancel: () => void
}) {
  const [form, setForm] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<DateForm>) => setForm((current) => ({ ...current, ...patch }))
  const submit = async (e: Event) => {
    e.preventDefault()
    const result = formToDateBody(form)
    if ('error' in result) return setError(result.error)
    setError(null)
    setSaving(true)
    try {
      await onSubmit(form)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save the date. Please try again.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <form class="people-form people-date-form" onSubmit={submit} noValidate>
      <div class="people-date-form-row">
        <label class="people-field">
          <span>Name</span>
          <input
            type="text"
            value={form.label}
            maxLength={PERSON_DATE_LABEL_MAX}
            placeholder="Wedding anniversary"
            onInput={(e) => set({ label: e.currentTarget.value })}
          />
        </label>
        <label class="people-field">
          <span>Kind</span>
          <select value={form.kind} onChange={(e) => set({ kind: e.currentTarget.value as PersonDateKind })}>
            {personDateKinds.map((kind) => (
              <option key={kind} value={kind}>
                {DATE_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset class="people-field">
        <legend>
          Date <small>(the year it first happened, if you know it)</small>
        </legend>
        <div class="people-date-inputs">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={31}
            aria-label="Day"
            placeholder="Day"
            value={form.day}
            onInput={(e) => set({ day: e.currentTarget.value })}
          />
          <select
            aria-label="Month"
            value={form.month}
            onChange={(e) => set({ month: e.currentTarget.value })}
          >
            <option value="">Month</option>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={String(i + 1)}>
                {monthName(i + 1)}
              </option>
            ))}
          </select>
          <input
            type="number"
            inputMode="numeric"
            aria-label="Year"
            placeholder="Year"
            value={form.year}
            onInput={(e) => set({ year: e.currentTarget.value })}
          />
        </div>
      </fieldset>
      <label class="people-notify">
        Remind me{' '}
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={60}
          aria-label="Days before"
          placeholder="–"
          value={form.notify}
          onInput={(e) => set({ notify: e.currentTarget.value })}
        />{' '}
        days before <small>(empty for no reminder, 0 on the day)</small>
      </label>
      {error && (
        <p class="people-error" role="alert">
          {error}
        </p>
      )}
      <div class="people-form-actions">
        <button type="submit" class="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        <button type="button" class="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function DatesSection({ person }: { person: PersonDetail }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<null | 'new' | string>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: PEOPLE_KEY })
  const remove = useMutation({
    mutationFn: (dateId: string) => deletePersonDate(person.id, dateId),
    onSettled: refresh,
  })
  const save = async (form: DateForm, dateId?: string) => {
    const result = formToDateBody(form)
    if ('error' in result) throw new Error(result.error)
    if (dateId) await updatePersonDate(person.id, dateId, result.body)
    else await addPersonDate(person.id, result.body)
    await refresh()
    setEditing(null)
  }
  return (
    <section class="people-section">
      <div class="people-section-head">
        <h2>Dates</h2>
        {editing === null && (
          <button type="button" class="btn-secondary" onClick={() => setEditing('new')}>
            Add date
          </button>
        )}
      </div>
      {editing === 'new' && (
        <div class="people-card people-editor">
          <DateEditor
            initial={EMPTY_DATE_FORM}
            submitLabel="Add date"
            onSubmit={(form) => save(form)}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}
      {person.dates.length === 0 && editing !== 'new' ? (
        <p class="people-muted">No dates yet: an anniversary, the day you met, a day to remember.</p>
      ) : (
        <ul class="people-card people-list">
          {person.dates.map((date) =>
            editing === date.id ? (
              <li key={date.id} class="people-row people-row--editing">
                <DateEditor
                  initial={dateToForm(date)}
                  submitLabel="Save"
                  onSubmit={(form) => save(form, date.id)}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={date.id} class="people-row">
                <span class="people-row-main">
                  <strong>{date.label}</strong>
                  <span class="people-muted">
                    {[
                      dateWhen(date),
                      DATE_KIND_LABELS[date.kind].toLowerCase(),
                      reminderText(date.notify_days_before),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span class="people-row-actions">
                  <button type="button" class="btn-secondary" onClick={() => setEditing(date.id)}>
                    Edit
                  </button>
                  <ConfirmButton
                    label="Delete"
                    confirmMessage={`Delete "${date.label}"?`}
                    onConfirm={() => remove.mutate(date.id)}
                    isPending={remove.isPending}
                    pendingLabel="Deleting…"
                  />
                </span>
              </li>
            ),
          )}
        </ul>
      )}
      {remove.error && (
        <p class="people-error" role="alert">
          {remove.error.message}
        </p>
      )}
    </section>
  )
}

function Account({ person }: { person: PersonDetail }) {
  const queryClient = useQueryClient()
  const actor = person.actor
  const follow = useMutation({
    mutationFn: () => followActor(actor?.handle ?? actor?.uri ?? ''),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: personKey(person.id) })
      void queryClient.invalidateQueries({ queryKey: ['following'] })
    },
  })
  if (!actor) return null
  return (
    <div class="people-account">
      <span class="people-account-ident">
        {actor.name && <strong>{actor.name}</strong>}
        <a href={actor.uri} target="_blank" rel="noopener noreferrer">
          {actor.handle ?? actor.uri}
        </a>
      </span>
      {!actor.following &&
        (follow.isSuccess ? (
          <span class="people-muted">Follow requested</span>
        ) : (
          <button
            type="button"
            class="btn-secondary"
            disabled={follow.isPending}
            onClick={() => follow.mutate()}
          >
            {follow.isPending ? 'Following…' : 'Follow'}
          </button>
        ))}
      {follow.error && (
        <span class="people-error" role="alert">
          {follow.error.message}
        </span>
      )}
    </div>
  )
}

function RecentPosts({ person }: { person: PersonDetail }) {
  const { data: posts, isLoading } = useQuery({
    enabled: Boolean(person.actor),
    queryFn: () => fetchPersonPosts(person.id, 10),
    queryKey: [...personKey(person.id), 'posts'],
  })
  if (!person.actor) return null
  return (
    <section class="people-section">
      <h2>Recent posts</h2>
      {isLoading ? (
        <p class="people-muted">Loading…</p>
      ) : !posts || posts.length === 0 ? (
        <p class="people-muted">
          No posts from them in your feed yet.{' '}
          {person.actor.following ? '' : 'Follow them to see what they post.'}
        </p>
      ) : (
        <div class="people-posts">
          {posts.map((entry) => (
            <TimelineCard key={entry.object_uri} entry={entry} />
          ))}
        </div>
      )}
    </section>
  )
}

function PersonJournal({ person }: { person: PersonDetail }) {
  return (
    <div class="people-section">
      <JournalEntryRefs
        title="Journal entries"
        entries={person.journal_entries ?? []}
        filter={{ id: person.id, type: 'person' }}
        empty={`None yet. Type @ in a journal entry to name ${person.name}, or relate an entry under Related.`}
      />
    </div>
  )
}

function RecentActivities({ person }: { person: PersonDetail }) {
  return (
    <section class="people-section">
      <div class="people-section-head">
        <h2>Activities together</h2>
        {person.recent_activities.length > 0 && (
          <a class="people-analyze" href={timeWithHref(person.id)}>
            Time with {person.name} in Analyze
          </a>
        )}
      </div>
      {person.recent_activities.length === 0 ? (
        <p class="people-muted">
          None yet. Choose {person.name} under “With” when you add or edit an activity.
        </p>
      ) : (
        <ul class="people-card people-list">
          {person.recent_activities.map((activity) => (
            <li key={activity.id} class="people-row">
              <a class="people-row-link" href={`/detail/activity/${encodeURIComponent(activity.id ?? '')}`}>
                <span class="people-row-main">
                  <strong>{activity.title || toDisplayName(activity.activity_type)}</strong>
                  <span class="people-muted">
                    {format(new Date(activity.start_time), 'EEE d MMM yyyy, HH:mm')}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function PersonPage({ id }: { id: string }) {
  const isLoggedIn = Boolean(auth.value.token)
  const queryClient = useQueryClient()
  const { route } = useLocation()
  const [editing, setEditing] = useState(false)
  const personQuery = useQuery({
    enabled: isLoggedIn,
    queryFn: () => fetchPerson(id),
    queryKey: personKey(id),
    retry: false,
  })
  const peopleQuery = useQuery({
    enabled: isLoggedIn && editing,
    queryFn: () => fetchPeople({ archived: true }),
    queryKey: [...PEOPLE_KEY, { archived: true }],
  })
  const remove = useMutation({
    mutationFn: () => deletePerson(id),
    onSuccess: () => {
      const name = personQuery.data?.name ?? 'the person'
      offerUndo(`Deleted ${name}.`, async () => {
        await restorePerson(id)
        await queryClient.invalidateQueries({ queryKey: PEOPLE_KEY })
      })
      route('/people')
      queryClient.removeQueries({ queryKey: personKey(id) })
      void queryClient.invalidateQueries({ queryKey: PEOPLE_KEY })
    },
  })

  if (!isLoggedIn) {
    return (
      <div class="people-page">
        <h1>People</h1>
        <p>Please log in to see the people in your life.</p>
      </div>
    )
  }
  const person = personQuery.data
  if (personQuery.isLoading) return <div class="people-page">Loading…</div>
  if (!person) {
    return (
      <div class="people-page">
        <p>
          <a href="/people">← People</a>
        </p>
        <p class="people-muted">
          This person isn’t here. They may have been deleted: look under Recently deleted.
        </p>
      </div>
    )
  }

  const details = [person.relationship, person.pronouns, person.archived ? 'archived' : null].filter(Boolean)
  const birthday = birthdayLabel(person.birth_date)

  return (
    <div class="people-page">
      <p class="people-back">
        <a href="/people">← People</a>
      </p>
      <UndoBar />
      {editing ? (
        <div class="people-card people-editor">
          <h2>Edit {person.name}</h2>
          <PersonForm
            person={person}
            people={peopleQuery.data?.people ?? []}
            suggestions={peopleQuery.data?.relationship_suggestions ?? []}
            submitLabel="Save"
            onSubmit={async (body) => {
              if (Object.keys(body).length > 0) await updatePerson(person.id, body)
              await queryClient.invalidateQueries({ queryKey: PEOPLE_KEY })
              setEditing(false)
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : (
        <header class="people-person-head">
          <PersonAvatar person={person} size={56} />
          <div class="people-person-ident">
            <h1>{person.name}</h1>
            {details.length > 0 && <p class="people-muted">{details.join(' · ')}</p>}
            {birthday && (
              <p class="people-birthday-line">
                🎂 {birthday}
                {person.birthday_notify_days_before !== null && (
                  <span class="people-muted"> · {reminderText(person.birthday_notify_days_before)}</span>
                )}
              </p>
            )}
            <Account person={person} />
          </div>
          <div class="people-person-actions">
            <button type="button" class="btn-secondary" onClick={() => setEditing(true)}>
              Edit
            </button>
            <ConfirmButton
              label="Delete"
              confirmMessage={`Delete ${person.name}? You can undo it, or restore them for 30 days.`}
              onConfirm={() => remove.mutate()}
              isPending={remove.isPending}
              pendingLabel="Deleting…"
            />
          </div>
          {remove.error && (
            <p class="people-error" role="alert">
              {remove.error.message}
            </p>
          )}
        </header>
      )}
      <DatesSection person={person} />
      <section class="people-section people-notes">
        <NotesSection entityType="person" entityId={person.id} title="Notes" />
      </section>
      <PersonJournal person={person} />
      <RecentActivities person={person} />
      <RecentPosts person={person} />
      <p class="people-private">
        Only you can see this page: nothing about {person.name} is shared or federated.
      </p>
    </div>
  )
}
