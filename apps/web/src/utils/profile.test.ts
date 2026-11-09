import { describe, expect, test } from 'vitest'

import { apiErrorText, profileHeading, signupProfileFields } from './profile'

describe('signupProfileFields', () => {
  test('trims both fields', () => {
    expect(signupProfileFields({ displayName: ' Ada ', email: ' Ada@Example.com ' })).toEqual({
      display_name: 'Ada',
      email: 'Ada@Example.com',
    })
  })

  test('leaves empty fields out', () => {
    expect(signupProfileFields({ displayName: '', email: '   ' })).toEqual({})
    expect(signupProfileFields({ displayName: 'Ada', email: '' })).toEqual({ display_name: 'Ada' })
  })
})

describe('apiErrorText', () => {
  test('passes a message through', () => {
    expect(apiErrorText('Username already exists', 'Signup failed')).toBe('Username already exists')
  })

  test('joins field errors', () => {
    expect(apiErrorText({ email: ['Not a valid email address'], username: ['Required'] }, 'x')).toBe(
      'Not a valid email address; Required',
    )
  })

  test.each([undefined, null, '', {}, { email: [] }])('falls back for %j', (error) => {
    expect(apiErrorText(error, 'Signup failed')).toBe('Signup failed')
  })
})

describe('profileHeading', () => {
  test('shows the display name over the handle', () => {
    expect(profileHeading('ada', 'Ada Lovelace')).toEqual({ handle: '@ada', title: 'Ada Lovelace' })
  })

  test.each([null, undefined, '', '  '])('shows only the handle without a name (%j)', (name) => {
    expect(profileHeading('ada', name)).toEqual({ handle: null, title: '@ada' })
  })
})
