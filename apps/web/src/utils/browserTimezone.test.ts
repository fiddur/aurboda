import type { UserSettingsResponse } from '@aurboda/api-spec'

import { describe, expect, test, vi } from 'vitest'

import { browserTimezone, createTimezoneAdopter, timezoneToAdopt } from './browserTimezone'

describe('browserTimezone', () => {
  test('answers the zone Intl resolves', () => {
    expect(browserTimezone(() => 'Europe/Stockholm')).toBe('Europe/Stockholm')
  })

  test('answers null when Intl gives nothing or throws', () => {
    expect(browserTimezone(() => '')).toBeNull()
    expect(browserTimezone(() => undefined)).toBeNull()
    expect(
      browserTimezone(() => {
        throw new Error('no Intl')
      }),
    ).toBeNull()
  })

  test('reads the real Intl by default', () => {
    expect(typeof browserTimezone()).toBe('string')
  })
})

describe('timezoneToAdopt', () => {
  test('adopts the browser zone only when none is stored', () => {
    expect(timezoneToAdopt(null, 'Europe/Stockholm')).toBe('Europe/Stockholm')
  })

  test('adopts nothing while the settings load, when a zone is stored, or without a browser zone', () => {
    expect(timezoneToAdopt(undefined, 'Europe/Stockholm')).toBeNull()
    expect(timezoneToAdopt('Asia/Kolkata', 'Europe/Stockholm')).toBeNull()
    expect(timezoneToAdopt(null, null)).toBeNull()
  })
})

const saved = (tz: string) => ({ success: true, tz }) as unknown as UserSettingsResponse

describe('createTimezoneAdopter', () => {
  test('an unset zone gets one save, and the answer is handed on', async () => {
    const adopt = createTimezoneAdopter()
    const save = vi.fn(async (tz: string) => saved(tz))
    const onSaved = vi.fn()
    const args = { browserTz: 'Europe/Stockholm', onSaved, save, storedTz: null, user: 'ada' }

    await adopt(args)
    await adopt(args)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('Europe/Stockholm')
    expect(onSaved).toHaveBeenCalledWith(saved('Europe/Stockholm'))
  })

  test('a stored zone gets no save', async () => {
    const adopt = createTimezoneAdopter()
    const save = vi.fn(async (tz: string) => saved(tz))

    await adopt({ browserTz: 'Europe/Stockholm', onSaved: vi.fn(), save, storedTz: 'UTC', user: 'ada' })
    await adopt({ browserTz: 'Europe/Stockholm', onSaved: vi.fn(), save, storedTz: undefined, user: 'ada' })

    expect(save).not.toHaveBeenCalled()
  })

  test('a failing save is swallowed and not repeated', async () => {
    const adopt = createTimezoneAdopter()
    const save = vi.fn(async () => {
      throw new Error('offline')
    })
    const onSaved = vi.fn()
    const args = { browserTz: 'Europe/Stockholm', onSaved, save, storedTz: null, user: 'ada' }

    await expect(adopt(args)).resolves.toBeUndefined()
    await adopt(args)

    expect(save).toHaveBeenCalledTimes(1)
    expect(onSaved).not.toHaveBeenCalled()
  })

  test('another user signing in on the same page gets their own try', async () => {
    const adopt = createTimezoneAdopter()
    const save = vi.fn(async (tz: string) => saved(tz))

    await adopt({ browserTz: 'Europe/Stockholm', onSaved: vi.fn(), save, storedTz: null, user: 'ada' })
    await adopt({ browserTz: 'Europe/Stockholm', onSaved: vi.fn(), save, storedTz: null, user: 'bob' })

    expect(save).toHaveBeenCalledTimes(2)
  })
})
