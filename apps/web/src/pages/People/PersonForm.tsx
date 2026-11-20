import type { FollowingActor, Person, UpdatePersonBody } from '@aurboda/api-spec'

import { PERSON_NAME_MAX, PERSON_PRONOUNS_MAX, PERSON_RELATIONSHIP_MAX } from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { fetchFollowing } from '../../state/api'
import { type BirthdayForm, followedWithoutProfile, monthName } from './people-view'
import { personFormBody, type PersonFormValues, personFormValues } from './person-form'

interface Props {
  person?: Person
  people: readonly Person[]
  suggestions: readonly string[]
  submitLabel: string
  onSubmit: (body: UpdatePersonBody) => Promise<unknown>
  onCancel: () => void
}

function AccountPicker({
  people,
  person,
  onPick,
}: {
  people: readonly Person[]
  person?: Person
  onPick: (account: FollowingActor) => void
}) {
  const { data: following = [] } = useQuery({ queryFn: fetchFollowing, queryKey: ['following'] })
  const accounts = followedWithoutProfile(
    following,
    people.filter((p) => p.id !== person?.id),
  )
  if (accounts.length === 0) return null
  return (
    <select
      class="people-account-pick"
      value=""
      aria-label="Pick from accounts you follow"
      onChange={(e) => {
        const account = accounts.find((a) => a.actor_uri === e.currentTarget.value)
        if (account) onPick(account)
      }}
    >
      <option value="">Pick from accounts you follow…</option>
      {accounts.map((account) => (
        <option key={account.actor_uri} value={account.actor_uri}>
          {account.display_name ? `${account.display_name} (${account.handle})` : account.handle}
        </option>
      ))}
    </select>
  )
}

export function PersonForm({ person, people, suggestions, submitLabel, onSubmit, onCancel }: Props) {
  const [values, setValues] = useState<PersonFormValues>(() => personFormValues(person))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<PersonFormValues>) => setValues((current) => ({ ...current, ...patch }))
  const setBirthday = (patch: Partial<BirthdayForm>) =>
    setValues((current) => ({ ...current, birthday: { ...current.birthday, ...patch } }))

  const submit = async (e: Event) => {
    e.preventDefault()
    const result = personFormBody(values, person)
    if ('error' in result) return setError(result.error)
    setError(null)
    setSaving(true)
    try {
      await onSubmit(result.body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const hasBirthday = values.birthday.day !== '' || values.birthday.month !== ''

  return (
    <form class="people-form" onSubmit={submit} noValidate>
      <label class="people-field">
        <span>Name</span>
        <input
          type="text"
          value={values.name}
          maxLength={PERSON_NAME_MAX}
          required
          placeholder="Anna"
          onInput={(e) => set({ name: e.currentTarget.value })}
        />
      </label>
      <label class="people-field">
        <span>
          Relationship <small>(optional)</small>
        </span>
        <input
          type="text"
          list="people-relationships"
          value={values.relationship}
          maxLength={PERSON_RELATIONSHIP_MAX}
          placeholder="friend"
          onInput={(e) => set({ relationship: e.currentTarget.value })}
        />
        <datalist id="people-relationships">
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </label>
      <fieldset class="people-field people-birthday">
        <legend>
          Birthday <small>(optional; the year too if you know it)</small>
        </legend>
        <div class="people-date-inputs">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={31}
            aria-label="Day"
            placeholder="Day"
            value={values.birthday.day}
            onInput={(e) => setBirthday({ day: e.currentTarget.value })}
          />
          <select
            aria-label="Month"
            value={values.birthday.month}
            onChange={(e) => setBirthday({ month: e.currentTarget.value })}
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
            value={values.birthday.year}
            onInput={(e) => setBirthday({ year: e.currentTarget.value })}
          />
        </div>
        {hasBirthday && (
          <label class="people-notify">
            Remind me{' '}
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={60}
              aria-label="Days before the birthday"
              value={values.notify}
              placeholder="–"
              onInput={(e) => set({ notify: e.currentTarget.value })}
            />{' '}
            days before <small>(empty for no reminder, 0 on the day)</small>
          </label>
        )}
      </fieldset>
      <label class="people-field">
        <span>
          Pronouns <small>(optional)</small>
        </span>
        <input
          type="text"
          value={values.pronouns}
          maxLength={PERSON_PRONOUNS_MAX}
          placeholder="she/her"
          onInput={(e) => set({ pronouns: e.currentTarget.value })}
        />
      </label>
      <div class="people-field">
        <label for="people-handle">
          Fediverse handle <small>(optional)</small>
        </label>
        <input
          id="people-handle"
          type="text"
          value={values.handle}
          placeholder="@anna@example.social"
          autoComplete="off"
          onInput={(e) => set({ handle: e.currentTarget.value })}
        />
        <small class="people-help">
          Their address on Mastodon or another fediverse server, like @anna@example.social.
        </small>
        <AccountPicker
          people={people}
          person={person}
          onPick={(account) =>
            set({
              handle: account.handle ?? account.actor_uri,
              ...(values.name.trim() ? {} : { name: account.display_name ?? '' }),
            })
          }
        />
      </div>
      {person && (
        <label class="people-check">
          <input
            type="checkbox"
            checked={values.archived}
            onChange={(e) => set({ archived: e.currentTarget.checked })}
          />
          Archived <small>(left out of the list and of upcoming dates)</small>
        </label>
      )}
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
