import { describe, expect, test } from 'vitest'

import {
  defaultSignupProfileDeps,
  parseSignupProfile,
  saveSignupProfile,
  type SignupProfileDeps,
} from './signup-profile.ts'

const recorder = (failing: { displayName?: boolean; email?: boolean } = {}) => {
  const calls: string[] = []
  const errors: string[] = []
  const deps: SignupProfileDeps = {
    logError: (message) => errors.push(message),
    setDisplayName: async (username, displayName) => {
      calls.push(`name ${username} ${displayName}`)
      if (failing.displayName) throw new Error('settings down')
    },
    setEmail: async (username, email) => {
      calls.push(`email ${username} ${email}`)
      if (failing.email) throw new Error('central down')
    },
  }
  return { calls, deps, errors }
}

describe('parseSignupProfile', () => {
  test('trims both fields and keeps the email case as typed', () => {
    expect(
      parseSignupProfile({ display_name: '  Ada  ', email: ' Ada@Example.com ', username: 'ada' }),
    ).toEqual({
      ok: true,
      profile: { display_name: 'Ada', email: 'Ada@Example.com' },
    })
  })

  test('absent fields stay absent', () => {
    expect(parseSignupProfile({ username: 'ada' })).toEqual({ ok: true, profile: {} })
    expect(parseSignupProfile(undefined)).toEqual({ ok: true, profile: {} })
  })

  test('empty fields pass (they mean none)', () => {
    expect(parseSignupProfile({ display_name: '', email: '  ' })).toEqual({
      ok: true,
      profile: { display_name: '', email: '' },
    })
  })

  test.each([
    [{ email: 'not-an-email' }, 'Not a valid email address'],
    [{ email: `${'a'.repeat(250)}@example.com` }, 'Email must be at most 254 characters'],
    [{ display_name: 'x'.repeat(101) }, 'Display name must be at most 100 characters'],
  ])('rejects %j', (body, error) => {
    expect(parseSignupProfile(body)).toEqual({ error, ok: false })
  })
})

describe('saveSignupProfile', () => {
  test('saves both when given', async () => {
    const { calls, deps, errors } = recorder()
    await saveSignupProfile(deps, 'ada', { display_name: 'Ada', email: 'ada@example.com' })

    expect(calls.toSorted()).toEqual(['email ada ada@example.com', 'name ada Ada'])
    expect(errors).toEqual([])
  })

  test('skips absent and empty fields', async () => {
    const { calls, deps } = recorder()
    await saveSignupProfile(deps, 'ada', {})
    await saveSignupProfile(deps, 'ada', { display_name: '', email: '' })

    expect(calls).toEqual([])
  })

  test('logs a failure to save either and resolves anyway', async () => {
    const { calls, deps, errors } = recorder({ displayName: true, email: true })
    await expect(
      saveSignupProfile(deps, 'ada', { display_name: 'Ada', email: 'ada@example.com' }),
    ).resolves.toBeUndefined()

    expect(calls).toHaveLength(2)
    expect(errors.toSorted()).toEqual([
      '⚠️ Failed to save the signup display name for ada:',
      '⚠️ Failed to save the signup email for ada:',
    ])
  })
})

describe('defaultSignupProfileDeps', () => {
  test('an email for an account without a row is not saved, and the failure is logged', async () => {
    const errors: string[] = []
    const setUserEmail = async () => null
    const deps = {
      ...defaultSignupProfileDeps({ setUserEmail }),
      logError: (message: string) => errors.push(message),
    }

    await saveSignupProfile(deps, 'ada', { email: 'ada@example.com' })

    expect(errors).toEqual(['⚠️ Failed to save the signup email for ada:'])
  })
})
