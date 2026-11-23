import { describe, expect, test } from 'vitest'

import { buildBarDataHref } from './barDataHref'

const filterOf = (href: string) => new URLSearchParams(href.split('?')[1]).get('data_filter')

describe('buildBarDataHref', () => {
  const info = (series_name?: string) => ({ bucket_start: '2026-06-01T00:00:00.000Z', series_name })

  test('filters by each data field of the series', () => {
    expect(filterOf(buildBarDataHref(info('happy / home'), 'walking', '1d', ['mood', 'place']))).toBe(
      'mood:happy,place:home',
    )
  })

  test('leaves out the @people part and keeps the others', () => {
    expect(filterOf(buildBarDataHref(info('Anna / happy'), 'walking', '1d', ['@people', 'mood']))).toBe(
      'mood:happy',
    )
  })

  test('no data filter when only @people breaks the bars down', () => {
    expect(filterOf(buildBarDataHref(info('Anna'), 'walking', '1d', ['@people']))).toBeNull()
  })
})
