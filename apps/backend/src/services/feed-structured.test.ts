import type { ArticleBlock, ArticleContent } from '@aurboda/api-spec'

import { feedStructuredArticleCorrelationBlockSchema } from '@aurboda/api-spec'
import { describe, expect, test, vi } from 'vitest'

import type { ContinuousCorrelation } from './correlations/explore.ts'

import { resolveStructuredCorrelationBlock, resolveStructuredImpactBlock } from './feed-structured.ts'

const PERSON_ID = '11111111-1111-4111-8111-111111111111'

const content: ArticleContent = {
  blocks: [],
  default_end: '2026-07-07T00:00:00.000Z',
  default_start: '2026-07-01T00:00:00.000Z',
  title: 'Meals',
}

const noEffect = {
  after_mean: null,
  before_mean: null,
  change: null,
  change_stddev: null,
  p_value: null,
  paired_occurrences: 0,
}

const impactData = (activity: string) => ({
  activity,
  avg_duration_min: 20,
  hr_effect: noEffect,
  hrv_effect: noEffect,
  occurrences: 0,
  stress_effect: noEffect,
  timeline: [],
  window_minutes: 30,
})

const correlation = (): ContinuousCorrelation =>
  ({
    group_comparison: null,
    n: 0,
    pearson: null,
    pearson_p: null,
    series: [],
    spearman: null,
  }) as unknown as ContinuousCorrelation

describe('resolveStructuredImpactBlock', () => {
  test('labels a meal sensitivity impact for readers', async () => {
    const block: Extract<ArticleBlock, { type: 'impact' }> = {
      activity: 'gluten-id',
      activity_type: 'meal_sensitivity',
      type: 'impact',
    }
    const resolved = await resolveStructuredImpactBlock('alice', block, content, async () =>
      impactData('meals with gluten'),
    )
    expect(resolved).toMatchObject({ activity: 'gluten-id', activity_label: 'meals with gluten' })
  })

  test('leaves other impacts without a label', async () => {
    const block: Extract<ArticleBlock, { type: 'impact' }> = {
      activity: 'yoga',
      activity_type: 'activity_type',
      type: 'impact',
    }
    const resolved = await resolveStructuredImpactBlock('alice', block, content, async () =>
      impactData('yoga'),
    )
    expect(resolved).not.toHaveProperty('activity_label')
  })
})

describe('resolveStructuredCorrelationBlock', () => {
  test('names the sensitivity flags its selectors use', async () => {
    const block: Extract<ArticleBlock, { type: 'correlation' }> = {
      outcome: { kind: 'metric', metric: 'hrv' },
      trigger: { flag: 'gluten-id', kind: 'sensitivity' },
      type: 'correlation',
    }
    const selectorNames = vi.fn(async () => ({ flag_names: { 'gluten-id': 'gluten' } }))
    const resolved = await resolveStructuredCorrelationBlock('alice', block, content, {
      correlate: async () => correlation(),
      selectorNames,
    })
    expect(selectorNames).toHaveBeenCalledWith('alice', [block])
    expect(resolved?.flag_names).toEqual({ 'gluten-id': 'gluten' })
    expect(resolved).not.toHaveProperty('person_names')
  })

  test('names the person its people selector names', async () => {
    const block: Extract<ArticleBlock, { type: 'correlation' }> = {
      outcome: { kind: 'metric', metric: 'hrv' },
      trigger: { kind: 'people', person_id: PERSON_ID },
      type: 'correlation',
    }
    const selectorNames = vi.fn(async () => ({ person_names: { [PERSON_ID]: 'Anna' } }))
    const resolved = await resolveStructuredCorrelationBlock('alice', block, content, {
      correlate: async () => correlation(),
      selectorNames,
    })
    expect(selectorNames).toHaveBeenCalledWith('alice', [block])
    expect(resolved?.person_names).toEqual({ [PERSON_ID]: 'Anna' })
    expect(resolved).not.toHaveProperty('flag_names')
    expect(feedStructuredArticleCorrelationBlockSchema.safeParse(resolved).success).toBe(true)
  })

  test('has no person names for the time with anyone', async () => {
    const block: Extract<ArticleBlock, { type: 'correlation' }> = {
      outcome: { kind: 'metric', metric: 'hrv' },
      trigger: { kind: 'people' },
      type: 'correlation',
    }
    const resolved = await resolveStructuredCorrelationBlock('alice', block, content, {
      correlate: async () => correlation(),
    })
    expect(resolved).not.toHaveProperty('person_names')
    expect(resolved).not.toHaveProperty('flag_names')
  })

  test('has no flag names without a sensitivity selector', async () => {
    const block: Extract<ArticleBlock, { type: 'correlation' }> = {
      outcome: { kind: 'metric', metric: 'hrv' },
      trigger: { kind: 'activity', pattern: 'run' },
      type: 'correlation',
    }
    const resolved = await resolveStructuredCorrelationBlock('alice', block, content, {
      correlate: async () => correlation(),
    })
    expect(resolved).not.toHaveProperty('flag_names')
  })
})
