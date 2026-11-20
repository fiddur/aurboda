import type { Person, UpdatePersonBody } from '@aurboda/api-spec'

import { type BirthdayForm, birthdayToForm, formToBirthday, parseNotifyDays } from './people-view'

export interface PersonFormValues {
  name: string
  relationship: string
  birthday: BirthdayForm
  notify: string
  pronouns: string
  handle: string
  archived: boolean
}

export const personFormValues = (person?: Person): PersonFormValues => ({
  archived: person?.archived ?? false,
  birthday: birthdayToForm(person?.birth_date),
  handle: person?.actor?.handle ?? '',
  name: person?.name ?? '',
  notify: person?.birthday_notify_days_before == null ? '' : String(person.birthday_notify_days_before),
  pronouns: person?.pronouns ?? '',
  relationship: person?.relationship ?? '',
})

type PersonFields = Required<Omit<UpdatePersonBody, 'handle'>> & { handle: string | null }

const FIELDS = [
  'name',
  'relationship',
  'pronouns',
  'birth_date',
  'birthday_notify_days_before',
  'archived',
] as const

/** Only the fields that differ from the person, the handle compared with the one it has. */
const changedFields = (next: PersonFields, person: Person): UpdatePersonBody => {
  const body: Record<string, unknown> = {}
  for (const field of FIELDS) if (next[field] !== person[field]) body[field] = next[field]
  if (next.handle !== (person.actor?.handle ?? null)) body.handle = next.handle
  return body as UpdatePersonBody
}

/** The add body, or an update body with only what changed, or an error to show. */
export const personFormBody = (
  values: PersonFormValues,
  person?: Person,
): { body: UpdatePersonBody } | { error: string } => {
  const name = values.name.trim()
  if (!name) return { error: 'Give the person a name.' }
  const birthday = formToBirthday(values.birthday)
  if ('error' in birthday) return birthday
  const notify = parseNotifyDays(values.notify)
  if ('error' in notify) return notify
  const next: PersonFields = {
    archived: values.archived,
    birth_date: birthday.value,
    birthday_notify_days_before: birthday.value === null ? null : notify.value,
    handle: values.handle.trim() || null,
    name,
    pronouns: values.pronouns.trim() || null,
    relationship: values.relationship.trim() || null,
  }
  if (person) return { body: changedFields(next, person) }
  const { handle, ...rest } = next
  return { body: handle ? { ...rest, handle } : rest }
}
