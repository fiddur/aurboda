import { expect, test } from 'vitest'
import { reduceTimeSeries } from './utils'

test('reduceTimeSeries', () => {
  const series: [Date, number][] = [
    [new Date('1976-03-04'), 42],
    [new Date('1976-03-05'), 43],
    [new Date('1976-03-04'), 42],
  ]

  expect(reduceTimeSeries(series)).toEqual([
    [new Date('1976-03-04'), 42],
    [new Date('1976-03-05'), 43],
  ])
})
