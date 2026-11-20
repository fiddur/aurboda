import type { Person } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { personFormBody, personFormValues } from './person-form'

const anna: Person = {
  actor: {
    following: true,
    handle: '@anna@example.social',
    icon: null,
    name: 'Anna',
    uri: 'https://ex/anna',
  },
  archived: false,
  birth_date: '--12-03',
  birthday_notify_days_before: 2,
  created_at: '2026-01-01T00:00:00Z',
  id: 'a',
  name: 'Anna',
  pronouns: null,
  relationship: 'partner',
  updated_at: '2026-01-01T00:00:00Z',
}

describe('personFormBody', () => {
  test('a new person sends what is filled in, the handle only when given', () => {
    const values = {
      ...personFormValues(),
      birthday: { day: '3', month: '12', year: '' },
      name: ' Bo ',
      notify: '1',
    }
    expect(personFormBody(values)).toEqual({
      body: {
        archived: false,
        birth_date: '--12-03',
        birthday_notify_days_before: 1,
        name: 'Bo',
        pronouns: null,
        relationship: null,
      },
    })
    expect(personFormBody({ ...values, handle: '@bo@ex.social' })).toMatchObject({
      body: { handle: '@bo@ex.social' },
    })
  })

  test('an edit sends only what changed', () => {
    expect(personFormBody(personFormValues(anna), anna)).toEqual({ body: {} })
    expect(personFormBody({ ...personFormValues(anna), handle: '', relationship: 'wife' }, anna)).toEqual({
      body: { handle: null, relationship: 'wife' },
    })
  })

  test('clearing the birthday clears its reminder', () => {
    const values = { ...personFormValues(anna), birthday: { day: '', month: '', year: '' } }
    expect(personFormBody(values, anna)).toEqual({
      body: { birth_date: null, birthday_notify_days_before: null },
    })
  })

  test('refuses an empty name and a bad birthday', () => {
    expect(personFormBody({ ...personFormValues(), name: ' ' })).toHaveProperty('error')
    expect(
      personFormBody({ ...personFormValues(), birthday: { day: '31', month: '2', year: '' }, name: 'X' }),
    ).toHaveProperty('error')
  })
})
