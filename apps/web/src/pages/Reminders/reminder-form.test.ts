import type { Reminder } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  emptyForm,
  formError,
  formFromReminder,
  formToAddBody,
  formToUpdateBody,
  OTHER_PAGE,
  pageLabel,
  roundTime,
  scheduleLine,
  toggleDay,
} from './reminder-form'

describe('scheduleLine', () => {
  test('names every day, weekdays and weekends', () => {
    expect(scheduleLine('20:00', [1, 2, 3, 4, 5, 6, 7])).toBe('Every day at 20:00')
    expect(scheduleLine('07:30', [1, 2, 3, 4, 5])).toBe('Weekdays at 07:30')
    expect(scheduleLine('09:00', [7, 6])).toBe('Weekends at 09:00')
  })

  test('lists other days in week order', () => {
    expect(scheduleLine('07:30', [5, 1, 3])).toBe('Mon, Wed, Fri at 07:30')
  })

  test('joins several times in time order', () => {
    expect(scheduleLine(['21:00', '08:00'], [1, 2, 3, 4, 5, 6, 7])).toBe('Every day at 08:00 and 21:00')
    expect(scheduleLine(['12:00', '08:00', '21:00'], [1, 2, 3, 4, 5])).toBe(
      'Weekdays at 08:00, 12:00 and 21:00',
    )
  })
})

describe('roundTime', () => {
  test('rounds to the nearest five minutes', () => {
    expect(roundTime('07:32')).toBe('07:30')
    expect(roundTime('07:33')).toBe('07:35')
    expect(roundTime('20:00')).toBe('20:00')
    expect(roundTime('23:58')).toBe('00:00')
  })

  test('null for something that is not a time', () => {
    expect(roundTime('')).toBeNull()
    expect(roundTime('25:00')).toBeNull()
    expect(roundTime('noon')).toBeNull()
  })
})

describe('toggleDay', () => {
  test('adds in order and removes', () => {
    expect(toggleDay([1, 5], 3)).toEqual([1, 3, 5])
    expect(toggleDay([1, 3, 5], 3)).toEqual([1, 5])
  })
})

describe('formError', () => {
  test('a filled-in default form is fine', () => {
    expect(formError({ ...emptyForm(), title: 'Stretch' })).toBeNull()
  })

  test('needs a name, a day and an in-app path', () => {
    expect(formError(emptyForm())).toBe('Give the reminder a name.')
    expect(formError({ ...emptyForm(), title: 'x', weekdays: [] })).toBe('Pick at least one day.')
    expect(
      formError({ ...emptyForm(), otherPath: 'https://example.com', page: OTHER_PAGE, title: 'x' }),
    ).toMatch(/starting with \//)
    expect(formError({ ...emptyForm(), otherPath: '//evil', page: OTHER_PAGE, title: 'x' })).not.toBeNull()
    expect(formError({ ...emptyForm(), otherPath: '/reports/1', page: OTHER_PAGE, title: 'x' })).toBeNull()
  })
})

describe('form to body', () => {
  const form = { ...emptyForm(), body: '  ', time: '07:32', title: ' Stretch ', weekdays: [5, 1] }

  test('an add leaves out empty text and no page', () => {
    expect(formToAddBody(form)).toEqual({
      body: undefined,
      enabled: true,
      link: undefined,
      time_of_day: '07:30',
      title: 'Stretch',
      weekdays: [1, 5],
    })
  })

  test('an edit clears text and page with null', () => {
    expect(formToUpdateBody(form)).toEqual({
      body: null,
      link: null,
      time_of_day: '07:30',
      title: 'Stretch',
      weekdays: [1, 5],
    })
  })

  test('the page comes from the select or the other path', () => {
    expect(formToUpdateBody({ ...form, page: '/reports' }).link).toBe('/reports')
    expect(formToUpdateBody({ ...form, otherPath: ' /reports/7 ', page: OTHER_PAGE }).link).toBe('/reports/7')
  })
})

describe('formFromReminder', () => {
  const reminder: Reminder = {
    body: 'How was today?',
    created_at: '2026-11-18T10:00:00Z',
    enabled: true,
    id: '1',
    link: '/reports',
    next_due_at: null,
    time_of_day: '20:00',
    title: 'Evening questionnaire',
    updated_at: '2026-11-18T10:00:00Z',
    weekdays: [1, 2],
  }

  test('a known page selects it', () => {
    expect(formFromReminder(reminder)).toMatchObject({ otherPath: '', page: '/reports' })
    expect(pageLabel('/reports')).toBe('Reports')
  })

  test('another path selects Other path', () => {
    expect(formFromReminder({ ...reminder, link: '/reports/7' })).toMatchObject({
      otherPath: '/reports/7',
      page: OTHER_PAGE,
    })
    expect(pageLabel('/reports/7')).toBe('/reports/7')
  })

  test('no link selects No page', () => {
    expect(formFromReminder({ ...reminder, link: null }).page).toBe('')
  })
})
