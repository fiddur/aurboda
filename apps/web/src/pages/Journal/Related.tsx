import type { Person } from '@aurboda/api-spec'
import type { JSX } from 'preact'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'preact/hooks'

import { IconPreview } from '../../components/IconPreview'
import {
  addPerson,
  fetchActivities,
  fetchActivityTypeDefinitions,
  fetchPeople,
  PEOPLE_KEY,
} from '../../state/api'
import { toDisplayName } from '../../utils/displayName'
import { newPersonName } from '../People/people-view'
import {
  activityLink,
  activityRowId,
  addLink,
  dayActivityOptions,
  dayActivityWindow,
  hasLink,
  linkKey,
  type MentionItem,
  mentionOptions,
  offeredPeople,
  personLink,
  type RelatedLink,
  relatedHref,
  removeLink,
} from './related'

/** Every person, archived ones included, for the names of the links they already have. */
export const usePeople = () =>
  useQuery({ queryFn: () => fetchPeople({ archived: true }), queryKey: [...PEOPLE_KEY, { archived: true }] })

/** Adds a person by name and refreshes the people lists; the caller takes the new person in `onSuccess`. */
export const useAddPerson = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => addPerson({ name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PEOPLE_KEY }),
  })
}

const useTypeDefinitions = () =>
  useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activityTypeDefinitions'],
    staleTime: 5 * 60_000,
  })

const useTypeName = (): ((type: string) => string) => {
  const definitions = useTypeDefinitions()
  return useMemo(() => {
    const names = new Map((definitions.data ?? []).map((d) => [d.name, d.display_name]))
    return (type: string) => names.get(type) ?? toDisplayName(type)
  }, [definitions.data])
}

const useTypeIcon = (): ((type: string | undefined) => string | undefined) => {
  const definitions = useTypeDefinitions()
  return useMemo(() => {
    const icons = new Map((definitions.data ?? []).map((d) => [d.name, d.icon ?? undefined]))
    return (type: string | undefined) => (type ? icons.get(type) : undefined)
  }, [definitions.data])
}

const ChipIcon = ({ link, typeIcon }: { link: RelatedLink; typeIcon: string | undefined }) =>
  link.entity_type === 'person' ? (
    <span aria-hidden="true">👤</span>
  ) : typeIcon ? (
    <span aria-hidden="true" class="journal-related-chip-icon">
      <IconPreview icon={typeIcon} size={16} />
    </span>
  ) : (
    <span aria-hidden="true">🏃</span>
  )

/**
 * The links as chips that open the person's or the activity's page; with `onRemove`, each has a ×.
 * A chip whose key is in `gone` is marked as removed since it was linked.
 */
export const RelatedChips = ({
  links,
  onRemove,
  gone,
}: {
  links: readonly RelatedLink[]
  onRemove?: (link: RelatedLink) => void
  gone?: ReadonlySet<string>
}) => {
  const typeIcon = useTypeIcon()
  return (
    <ul class="journal-related-chips" aria-label="Related">
      {links.map((link) => {
        const isGone = gone?.has(linkKey(link)) ?? false
        const goneTitle = `This ${link.entity_type} was removed. Remove the link to save the entry.`
        return (
          <li
            key={linkKey(link)}
            class={`journal-related-chip is-${link.entity_type}${isGone ? ' is-gone' : ''}`}
            title={isGone ? goneTitle : undefined}
          >
            <ChipIcon link={link} typeIcon={typeIcon(link.activity_type)} />
            {isGone ? <span>{link.label}</span> : <a href={relatedHref(link)}>{link.label}</a>}
            {isGone && <small class="journal-related-gone">removed</small>}
            {onRemove && (
              <button type="button" aria-label={`Remove ${link.label}`} onClick={() => onRemove(link)}>
                ×
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

const PeopleOptions = ({
  links,
  onAdd,
}: {
  links: readonly RelatedLink[]
  onAdd: (link: RelatedLink) => void
}) => {
  const people = usePeople()
  const addNew = useAddPerson()
  const [query, setQuery] = useState('')
  const everyone = people.data?.people ?? []
  const list = offeredPeople(everyone).filter((p) => !hasLink(links, personLink(p)))
  const shown = query.trim() ? mentionOptions(list, query) : list
  const newName = people.data ? newPersonName(everyone, query) : null
  const take = (person: Person) => {
    onAdd(personLink(person))
    setQuery('')
  }
  const create = (name: string) => {
    if (addNew.isPending) return
    addNew.mutate(name, {
      onSuccess: (person) => {
        if (person) take(person)
      },
    })
  }
  return (
    <div class="journal-related-options">
      <input
        type="search"
        placeholder="Search people"
        aria-label="Search people"
        value={query}
        onInput={(e) => {
          setQuery(e.currentTarget.value)
          addNew.reset()
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.isComposing) return
          e.preventDefault()
          if (!query.trim()) return
          const first = shown[0]
          if (first) take(first)
          else if (newName !== null) create(newName)
        }}
      />
      {people.isLoading && <p class="journal-muted">Loading…</p>}
      {!people.isLoading && shown.length === 0 && newName === null && (
        <p class="journal-muted">
          {offeredPeople(everyone).length === 0 && !query.trim()
            ? 'No people yet. Type a name to add someone.'
            : 'Nobody matches.'}
        </p>
      )}
      <ul>
        {shown.map((person: Person) => (
          <li key={person.id}>
            <button type="button" class="journal-related-option" onClick={() => take(person)}>
              <strong>{person.name}</strong>
              {person.relationship && <span class="journal-muted"> · {person.relationship}</span>}
            </button>
          </li>
        ))}
        {newName !== null && (
          <li>
            <button
              type="button"
              class="journal-related-option"
              disabled={addNew.isPending}
              onClick={() => create(newName)}
            >
              <NewPersonLabel name={newName} pending={addNew.isPending} />
            </button>
          </li>
        )}
      </ul>
      {addNew.error && (
        <p class="journal-error" role="alert">
          {addNew.error.message}
        </p>
      )}
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
  gone,
}: {
  links: readonly RelatedLink[]
  entryDate: string
  onChange: (links: RelatedLink[]) => void
  gone?: ReadonlySet<string>
}) => {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'person' | 'activity'>('person')
  const add = (link: RelatedLink) => onChange(addLink(links, link))
  return (
    <div class="journal-field journal-related">
      <span>Related</span>
      <div class="journal-related-line">
        <RelatedChips links={links} gone={gone} onRemove={(link) => onChange(removeLink(links, link))} />
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

const NewPersonLabel = ({ name, pending }: { name: string; pending: boolean }) =>
  pending ? (
    <>Adding “{name}”…</>
  ) : (
    <>
      “{name}”: <span class="journal-muted">add as a person</span>
    </>
  )

/** The people offered while an `@name` is typed, and adding the name as a new person. Keys are handled by the editor's text area. */
export const MentionMenu = ({
  items,
  active,
  onPick,
  pending = false,
  menuRef,
  style,
}: {
  items: readonly MentionItem<Person>[]
  active: number
  onPick: (item: MentionItem<Person>) => void
  pending?: boolean
  menuRef?: { current: HTMLUListElement | null }
  style?: JSX.CSSProperties
}) =>
  items.length === 0 ? null : (
    <ul class="journal-mention-menu" role="listbox" aria-label="People" ref={menuRef} style={style}>
      {items.map((item, index) => (
        <li
          key={item.kind === 'person' ? item.person.id : `new:${item.name}`}
          role="option"
          aria-selected={index === active}
        >
          <button
            type="button"
            class={index === active ? 'active' : ''}
            disabled={item.kind === 'new' && pending}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(item)}
          >
            {item.kind === 'person' ? (
              <>
                {item.person.name}
                {item.person.relationship && <span class="journal-muted"> · {item.person.relationship}</span>}
              </>
            ) : (
              <NewPersonLabel name={item.name} pending={pending} />
            )}
          </button>
        </li>
      ))}
    </ul>
  )
