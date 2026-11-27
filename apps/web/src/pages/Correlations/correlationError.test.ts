import { describe, expect, test } from 'vitest'

import { correlationErrorText } from './correlationError'

describe('correlationErrorText', () => {
  test('replaces the API message for an unknown person', () => {
    expect(correlationErrorText('Unknown people: 11111111-1111-4111-8111-111111111111')).toBe(
      'This analysis uses a person no longer listed.',
    )
  })

  test('keeps any other message', () => {
    expect(correlationErrorText('Analysis failed. Check the inputs and retry.')).toBe(
      'Analysis failed. Check the inputs and retry.',
    )
  })
})
