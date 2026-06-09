import { describe, expect, it } from 'vitest'

import { eventOutcomeLooksContinuous } from './exploreGuidance'

describe('eventOutcomeLooksContinuous', () => {
  it('flags a built-in (continuous) metric chosen as an event outcome', () => {
    expect(eventOutcomeLooksContinuous('event', 'metric', 'sleep_score')).toBe(true)
    expect(eventOutcomeLooksContinuous('event', 'metric', 'hrv_rmssd')).toBe(true)
    expect(eventOutcomeLooksContinuous('event', 'metric', 'weight')).toBe(true)
  })

  it('does not flag presence-only custom metrics (the ones event mode is for)', () => {
    expect(eventOutcomeLooksContinuous('event', 'metric', 'back_pain')).toBe(false)
    expect(eventOutcomeLooksContinuous('event', 'metric', 'fissure_pain')).toBe(false)
  })

  it('ignores surrounding whitespace on the metric name', () => {
    expect(eventOutcomeLooksContinuous('event', 'metric', '  sleep_score ')).toBe(true)
  })

  it('never flags in continuous mode', () => {
    expect(eventOutcomeLooksContinuous('continuous', 'metric', 'sleep_score')).toBe(false)
  })

  it('never flags a tag outcome (tags are inherently event-like)', () => {
    expect(eventOutcomeLooksContinuous('event', 'tag', 'sleep_score')).toBe(false)
  })

  it('does not flag an empty outcome', () => {
    expect(eventOutcomeLooksContinuous('event', 'metric', '')).toBe(false)
  })
})
