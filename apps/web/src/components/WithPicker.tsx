import type { AddPersonBody } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { nameForAccount, newPersonName, withPickerOptions } from '../pages/People/people-view'
import { addPerson, fetchFollowing, fetchPeople, PEOPLE_KEY } from '../state/api'
import './WithPicker.css'

interface Props {
  /** Person ids. */
  value: readonly string[]
  onChange: (ids: string[]) => void
  id?: string
}

/** "With": who an activity was with, picked from the user's people by name, or added from a followed account. */
export function WithPicker({ value, onChange, id = 'with-picker' }: Props) {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const { data: people = [] } = useQuery({
    queryFn: () => fetchPeople({ archived: true }),
    queryKey: [...PEOPLE_KEY, { archived: true }],
    select: (data) => data.people ?? [],
    staleTime: 60_000,
  })
  const { data: following = [] } = useQuery({
    enabled: open,
    queryFn: fetchFollowing,
    queryKey: ['following'],
    staleTime: 5 * 60_000,
  })
  const addNew = useMutation({
    mutationFn: (body: AddPersonBody) => addPerson(body),
    onSuccess: async (person) => {
      await queryClient.invalidateQueries({ queryKey: PEOPLE_KEY })
      if (person) onChange([...value, person.id])
      setQuery('')
    },
  })

  const chosen = value.map((personId) => ({
    id: personId,
    name: people.find((p) => p.id === personId)?.name ?? '…',
  }))
  const options = withPickerOptions(
    people.filter((p) => !p.archived),
    following,
    value,
    query,
  )
  const pick = (personId: string) => {
    onChange([...value, personId])
    setQuery('')
  }
  const newName = newPersonName(people, query)
  const canAddNew = newName !== null
  const hasOptions = options.people.length > 0 || options.accounts.length > 0 || canAddNew

  return (
    <div class="with-picker">
      {chosen.length > 0 && (
        <ul class="with-chips" aria-label="With">
          {chosen.map((person) => (
            <li key={person.id} class="with-chip">
              {person.name}
              <button
                type="button"
                aria-label={`Remove ${person.name}`}
                onClick={() => onChange(value.filter((v) => v !== person.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open && hasOptions}
        aria-controls={`${id}-options`}
        autoComplete="off"
        placeholder="Type a name…"
        value={query}
        onInput={(e) => {
          setQuery(e.currentTarget.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            const first = options.people[0]
            if (first) pick(first.id)
            else if (canAddNew && !addNew.isPending) addNew.mutate({ name: newName })
          } else if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && hasOptions && (
        <ul class="with-options" id={`${id}-options`} role="listbox">
          {options.people.map((person) => (
            <li key={person.id} role="option" aria-selected={false}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(person.id)}>
                {person.name}
                {person.relationship && <small> · {person.relationship}</small>}
              </button>
            </li>
          ))}
          {options.accounts.map((account) => (
            <li key={account.actor_uri} role="option" aria-selected={false} class="with-option-account">
              <button
                type="button"
                disabled={addNew.isPending}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() =>
                  addNew.mutate({
                    handle: account.handle ?? account.actor_uri,
                    name: nameForAccount(account),
                  })
                }
              >
                {account.handle}: <span>add as a person</span>
              </button>
            </li>
          ))}
          {canAddNew && (
            <li role="option" aria-selected={false} class="with-option-account">
              <button
                type="button"
                disabled={addNew.isPending}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addNew.mutate({ name: newName })}
              >
                “{newName}”: <span>add as a person</span>
              </button>
            </li>
          )}
        </ul>
      )}
      {addNew.error && (
        <p class="with-error" role="alert">
          {addNew.error.message}
        </p>
      )}
    </div>
  )
}

/** "With Anna, Bo", each name linking to the person. */
export function WithLine({ people }: { people: readonly { id: string; name: string }[] | undefined }) {
  if (!people || people.length === 0) return null
  return (
    <span class="with-line">
      {people.map((person, i) => (
        <span key={person.id}>
          {i > 0 && ', '}
          <a href={`/people/${encodeURIComponent(person.id)}`}>{person.name}</a>
        </span>
      ))}
    </span>
  )
}
