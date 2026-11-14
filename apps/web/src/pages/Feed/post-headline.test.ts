import { describe, expect, it } from 'vitest'

import { postHeadline } from './post-headline'

describe('postHeadline', () => {
  it("uses the activity's title when it has one", () => {
    expect(postHeadline({ activity_title: 'Morning run', activity_type: 'running' })).toBe('Morning run')
  })

  it('names an untitled activity by its type, as the federated Note does', () => {
    expect(postHeadline({ activity_type: 'coffee' })).toBe('Coffee activity')
    expect(postHeadline({ activity_type: 'strength_training' })).toBe('Strength training activity')
  })

  it('falls back to a generic headline when the activity is gone', () => {
    expect(postHeadline({})).toBe('Shared activity')
  })
})
