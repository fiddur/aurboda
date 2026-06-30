import { describe, expect, it } from 'vitest'

import {
  describeCorrelationStrength,
  describeEffectSize,
  eventOutcomeLooksContinuous,
  sampleCaution,
} from './exploreGuidance'

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

describe('describeCorrelationStrength', () => {
  it('labels negligible without a direction', () => {
    expect(describeCorrelationStrength(0.05)).toBe('negligible')
    expect(describeCorrelationStrength(-0.09)).toBe('negligible')
  })

  it('labels strength and direction for meaningful coefficients', () => {
    expect(describeCorrelationStrength(0.2)).toBe('weak positive')
    expect(describeCorrelationStrength(-0.4)).toBe('moderate negative')
    expect(describeCorrelationStrength(0.6)).toBe('strong positive')
    expect(describeCorrelationStrength(-0.9)).toBe('very strong negative')
  })

  it('handles null', () => {
    expect(describeCorrelationStrength(null)).toBe('not enough data')
  })
})

describe('describeEffectSize', () => {
  it('maps Cohen d to standard buckets', () => {
    expect(describeEffectSize(0.1)).toBe('negligible')
    expect(describeEffectSize(0.3)).toBe('small')
    expect(describeEffectSize(-0.6)).toBe('medium')
    expect(describeEffectSize(1.2)).toBe('large')
    expect(describeEffectSize(null)).toBe('not estimable')
  })
})

describe('sampleCaution', () => {
  it('flags very small and small samples, clears at 30+', () => {
    expect(sampleCaution(5)).toContain('anecdotal')
    expect(sampleCaution(20)).toContain('caution')
    expect(sampleCaution(50)).toBeNull()
  })
})
