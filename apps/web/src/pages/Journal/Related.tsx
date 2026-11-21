import type { Person } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'preact/hooks'

import { fetchActivities, fetchActivityTypeDefinitions, fetchPeople, PEOPLE_KEY } from '../../state/api'
import { toDisplayName } from '../../utils/displayName'
import {
  activityLink,
  activityRowId,
  addLink,
  dayActivityOptions,
  dayActivityWindow,
  hasLink,
  mentionOptions,
  personLink,
  type RelatedLink,
  relatedHref,
  removeLink,
} from './related'

/** Every person, archived ones included: an entry may well be about someone no longer in the list. */
export const usePeople = () =>
  useQuery({ queryFn: () => fetchPeople({ archived: true }), queryKey: [...PEOPLE_KEY, { archived: true }] })

const useTypeName = (): ((type: string) => string) => {
  const definitions = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activityTypeDefinitions'],
    staleTime: 5 * 60_000,
  })
  return useMemo(() => {
    const names = new Map((definitions.data ?? []).map((d) => [d.name, d.display_name]))
    return (type: string) => names.get(type) ?? toDisplayName(type)
  }, [definitions.data])
}

/** The links as chips that open the person's or the activity's page; with `onRemove`, each has a ×. */
export const RelatedChips = ({
  links,
  onRemove,
}: {
  links: readonly RelatedLink[]
  onRemove?: (link: RelatedLink) => void
}) => (
  <ul class="journal-related-chips" aria-label="Related">
    {links.map((link) => (
      <li key={`${link.entity_type}:${link.entity_id}`} class={`journal-related-chip is-${link.entity_type}`}>
        <span aria-hidden="true">{link.entity_type === 'person' ? '👤' : '🏃'}</span>
        <a href={relatedHref(link)}>{link.label}</a>
        {onRemove && (
          <button type="button" aria-label={`Remove ${link.label}`} onClick={() => onRemove(link)}>
            ×
          </button>
        )}
      </li>
    ))}
  </ul>
)

const PeopleOptions = ({
  links,
  onAdd,
}: {
  links: readonly RelatedLink[]
  onAdd: (link: RelatedLink) => void
}) => {
  const people = usePeople()
  const [query, setQuery] = useState('')
  const list = (people.data?.people ?? []).filter((p) => !hasLink(links, personLink(p)))
  const shown = query.trim() ? mentionOptions(list, query) : list
  return (
    <div class="journal-related-options">
      <input
        type="search"
        placeholder="Search people"
        aria-label="Search people"
        value={query}
        onInput={(e) => setQuery(e.currentTarget.value)}
      />
      {people.isLoading && <p class="journal-muted">Loading…</p>}
      {!people.isLoading && shown.length === 0 && (
        <p class="journal-muted">
          {(people.data?.people ?? []).length === 0 ? (
            <>
              No people yet. <a href="/people">Add someone</a>.
            </>
          ) : (
            'Nobody matches.'
          )}
        </p>
      )}
      <ul>
        {shown.map((person: Person) => (
          <li key={person.id}>
            <button type="button" class="journal-related-option" onClick={() => onAdd(personLink(person))}>
              <strong>{person.name}</strong>
              {person.relationship && <span class="journal-muted"> · {person.relationship}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

const ActivityOptions = ({
  entryDate,
  links,
  onAdd,
}: {
  entryDate: string
  links: readonly RelatedLink[]
  onAdd: (link: RelatedLink) => void
}) => {
  const [date, setDate] = useState(entryDate)
  const [type, setType] = useState('')
  const typeName = useTypeName()
  const range = dayActivityWindow(date)
  const activities = useQuery({
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(date),
    queryFn: () => fetchActivities(range.start, range.end),
    queryKey: ['journal-related-activities', date],
  })
  const shown = dayActivityOptions(activities.data ?? [], date, type, typeName).filter(
    (a) => !hasLink(links, { entity_id: activityRowId(a), entity_type: 'activity' }),
  )
  return (
    <div class="journal-related-options">
      <div class="journal-related-search">
        <label>
          <span>Day</span>
          <input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} />
        </label>
        <label>
          <span>Type</span>
          <input
            type="search"
            placeholder="e.g. walk, sleep"
            value={type}
            onInput={(e) => setType(e.currentTarget.value)}
          />
        </label>
      </div>
      {activities.isLoading && <p class="journal-muted">Loading…</p>}
      {!activities.isLoading && shown.length === 0 && <p class="journal-muted">No activities that day.</p>}
      <ul>
        {shown.map((activity) => {
          const link = activityLink(activity, typeName)
          return (
            <li key={link.entity_id}>
              <button type="button" class="journal-related-option" onClick={() => onAdd(link)}>
                <strong>{activity.title?.trim() || typeName(activity.activity_type)}</strong>
                <span class="journal-muted">
                  {' '}
                  · {activity.start_time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {activity.end_time &&
                    `–${activity.end_time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** The editor's Related row: the chips, and a picker for people and the activities of the entry's day. */
export const RelatedRow = ({
  links,
  entryDate,
  onChange,
}: {
  links: readonly RelatedLink[]
  entryDate: string
  onChange: (links: RelatedLink[]) => void
}) => {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'person' | 'activity'>('person')
  const add = (link: RelatedLink) => onChange(addLink(links, link))
  return (
    <div class="journal-field journal-related">
      <span>Related</span>
      <div class="journal-related-line">
        <RelatedChips links={links} onRemove={(link) => onChange(removeLink(links, link))} />
        <button
          type="button"
          class="btn-secondary journal-related-add"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Done' : '+ Add'}
        </button>
      </div>
      {links.length === 0 && !open && (
        <small class="journal-muted">
          People and activities this entry is about. Type @ to name someone.
        </small>
      )}
      {open && (
        <div class="journal-card journal-related-picker">
          <div class="journal-related-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'person'}
              onClick={() => setTab('person')}
            >
              People
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'activity'}
              onClick={() => setTab('activity')}
            >
              Activities
            </button>
          </div>
          {tab === 'person' ? (
            <PeopleOptions links={links} onAdd={add} />
          ) : (
            <ActivityOptions entryDate={entryDate} links={links} onAdd={add} />
          )}
        </div>
      )}
    </div>
  )
}

/** The people offered while an `@name` is typed. Keys are handled by the editor's text area. */
export const MentionMenu = ({
  options,
  active,
  onPick,
}: {
  options: readonly Person[]
  active: number
  onPick: (person: Person) => void
}) =>
  options.length === 0 ? null : (
    <ul class="journal-mention-menu" role="listbox" aria-label="People">
      {options.map((person, index) => (
        <li key={person.id} role="option" aria-selected={index === active}>
          <button
            type="button"
            class={index === active ? 'active' : ''}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(person)}
          >
            {person.name}
            {person.relationship && <span class="journal-muted"> · {person.relationship}</span>}
          </button>
        </li>
      ))}
    </ul>
  )
