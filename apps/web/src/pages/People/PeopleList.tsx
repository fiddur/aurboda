import type { ImportantDate, Person } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useState } from 'preact/hooks'

import { addPerson, fetchImportantDates, fetchPeople, PEOPLE_KEY, restorePerson } from '../../state/api'
import { auth } from '../../state/auth'
import { daysLeft, daysLeftLabel } from '../Journal/journal-list'
import {
  filterPeople,
  importantDateDetail,
  importantDateTitle,
  localDateKey,
  nextDateByPerson,
  relativeDay,
} from './people-view'
import { PersonForm } from './PersonForm'
import { UndoBar } from './undo'

const FILTER_FROM = 10

export const personHref = (id: string) => `/people/${encodeURIComponent(id)}`

export function PersonAvatar({
  person,
  size = 36,
}: {
  person: Pick<Person, 'actor' | 'name'>
  size?: number
}) {
  const icon = person.actor?.icon
  return icon ? (
    <img class="people-avatar" src={icon} alt="" width={size} height={size} loading="lazy" />
  ) : (
    <span class="people-avatar people-avatar--blank" aria-hidden="true" style={{ height: size, width: size }}>
      {person.name.trim().charAt(0).toUpperCase()}
    </span>
  )
}

function UpcomingDates({ dates, today }: { dates: ImportantDate[]; today: string }) {
  if (dates.length === 0) return null
  return (
    <section class="people-card people-upcoming" aria-labelledby="people-upcoming-title">
      <h2 id="people-upcoming-title">Upcoming dates</h2>
      <ul>
        {dates.map((date) => (
          <li key={`${date.person.id}-${date.date_id ?? 'birthday'}-${date.date}`}>
            <a href={personHref(date.person.id)}>
              <span class={`people-date-glyph people-date-glyph--${date.kind}`} aria-hidden="true">
                {date.kind === 'birthday' ? '🎂' : '⭐'}
              </span>
              <span class="people-upcoming-text">
                <strong>{importantDateTitle(date)}</strong>
                <span class="people-muted">{importantDateDetail(date, today)}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

function RecentlyDeleted() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const { data } = useQuery({
    enabled: open,
    queryFn: () => fetchPeople({ deleted: true }),
    queryKey: [...PEOPLE_KEY, 'deleted'],
  })
  const restore = useMutation({
    mutationFn: restorePerson,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PEOPLE_KEY }),
  })
  const deleted = data?.people ?? []
  return (
    <details class="people-deleted" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Recently deleted</summary>
      {open && deleted.length === 0 && <p class="people-muted">Nothing deleted in the last 30 days.</p>}
      {deleted.length > 0 && (
        <ul class="people-card people-list">
          {deleted.map((person) => (
            <li key={person.id} class="people-row">
              <span class="people-row-main">
                <strong>{person.name}</strong>
                <small class="people-muted">{daysLeftLabel(daysLeft(person.purge_at))}</small>
              </span>
              <button
                type="button"
                class="btn-secondary"
                disabled={restore.isPending}
                onClick={() => restore.mutate(person.id)}
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
      {restore.error && (
        <p class="people-error" role="alert">
          {restore.error.message}
        </p>
      )}
    </details>
  )
}

function EmptyState() {
  return (
    <div class="people-empty">
      <p>
        Keep the people in your life here: their birthdays and the dates that matter, notes about them, and
        the activities you do together.
      </p>
      <p>It is private: nothing here is shared or federated.</p>
    </div>
  )
}

function PeopleRows({
  people,
  nextDates,
  today,
  loading,
  failed,
}: {
  people: Person[]
  nextDates: Map<string, ImportantDate>
  today: string
  loading: boolean
  failed: boolean
}) {
  if (loading) return <p class="people-muted">Loading…</p>
  if (failed) return <p class="people-muted">Couldn’t load the people. Please try again.</p>
  if (people.length === 0) return <p class="people-muted">No one matches.</p>
  return (
    <ul class="people-card people-list">
      {people.map((person) => {
        const next = nextDates.get(person.id)
        const details = [person.relationship, person.archived ? 'archived' : null].filter(Boolean)
        return (
          <li key={person.id} class={`people-row${person.archived ? ' archived' : ''}`}>
            <a class="people-row-link" href={personHref(person.id)}>
              <PersonAvatar person={person} />
              <span class="people-row-main">
                <strong>{person.name}</strong>
                {details.length > 0 && <span class="people-muted">{details.join(' · ')}</span>}
              </span>
              {next && (
                <span class="people-row-next">
                  {next.date_id === null ? 'Birthday' : next.label} {relativeDay(next.date, today)}
                </span>
              )}
            </a>
          </li>
        )
      })}
    </ul>
  )
}

export function PeopleList() {
  const isLoggedIn = Boolean(auth.value.token)
  const queryClient = useQueryClient()
  const { route } = useLocation()
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const today = localDateKey(new Date())

  const peopleQuery = useQuery({
    enabled: isLoggedIn,
    queryFn: () => fetchPeople({ archived: showArchived }),
    queryKey: [...PEOPLE_KEY, { archived: showArchived }],
  })
  const datesQuery = useQuery({
    enabled: isLoggedIn,
    queryFn: () => fetchImportantDates(),
    queryKey: [...PEOPLE_KEY, 'dates', today],
  })

  if (!isLoggedIn) {
    return (
      <div class="people-page">
        <h1>People</h1>
        <p>Please log in to see the people in your life.</p>
      </div>
    )
  }

  const { people = [], relationship_suggestions: suggestions = [] } = peopleQuery.data ?? {}
  const dates = datesQuery.data?.dates ?? []
  const nextDates = nextDateByPerson(dates)
  const shown = filterPeople(people, query)
  const empty = !peopleQuery.isLoading && !peopleQuery.error && people.length === 0 && !showArchived

  return (
    <div class="people-page">
      <div class="people-header">
        <h1>People</h1>
        {!adding && (
          <button type="button" class="btn-primary" onClick={() => setAdding(true)}>
            Add person
          </button>
        )}
      </div>
      <UndoBar />
      {adding && (
        <div class="people-card people-editor">
          <h2>New person</h2>
          <PersonForm
            people={people}
            suggestions={suggestions}
            submitLabel="Add person"
            onSubmit={async (body) => {
              const person = await addPerson({ ...body, name: body.name ?? '' })
              await queryClient.invalidateQueries({ queryKey: PEOPLE_KEY })
              setAdding(false)
              if (person) route(personHref(person.id))
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}
      {empty ? (
        !adding && <EmptyState />
      ) : (
        <>
          <UpcomingDates dates={dates} today={today} />
          <div class="people-toolbar">
            {people.length > FILTER_FROM && (
              <input
                type="search"
                class="people-filter"
                placeholder="Filter by name, relationship or handle"
                aria-label="Filter people"
                value={query}
                onInput={(e) => setQuery(e.currentTarget.value)}
              />
            )}
            <label class="people-check">
              <input
                type="checkbox"
                role="switch"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.currentTarget.checked)}
              />
              Show archived
            </label>
          </div>
          <PeopleRows
            people={shown}
            nextDates={nextDates}
            today={today}
            loading={peopleQuery.isLoading}
            failed={Boolean(peopleQuery.error)}
          />
        </>
      )}
      <RecentlyDeleted />
    </div>
  )
}
