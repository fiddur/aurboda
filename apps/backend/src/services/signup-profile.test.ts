import { signupProfileSchema, updateSettingsInputSchema } from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import { defaultSignupProfileDeps, saveSignupProfile, type SignupProfileDeps } from './signup-profile.ts'

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

describe('display name validation', () => {
  test.each([
    ['a bidi override', 'Ada\u202Eevil'],
    ['a bidi isolate', 'Ada\u2066evil'],
    ['a tab', 'Ada\tLovelace'],
    ['a newline', 'Ada\nLovelace'],
    ['a C1 control', 'Ada\u0085Lovelace'],
  ])('refuses %s, in signup and in settings', (_label, display_name) => {
    const message = 'Display name must not contain control or bidirectional formatting characters'
    for (const schema of [signupProfileSchema, updateSettingsInputSchema]) {
      const parsed = schema.safeParse({ display_name })
      expect(parsed.success).toBe(false)
      expect(parsed.error?.issues.map((issue) => issue.message)).toEqual([message])
    }
  })

  test('accepts an ordinary name, accents and right-to-left script included', () => {
    for (const display_name of ['Ada Lovelace', 'Åsa Ödmark', 'שלום']) {
      expect(signupProfileSchema.safeParse({ display_name }).success).toBe(true)
      expect(updateSettingsInputSchema.safeParse({ display_name }).success).toBe(true)
    }
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
