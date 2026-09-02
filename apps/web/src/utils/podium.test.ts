import { describe, expect, test } from 'vitest'

import { competitionRanks, podiumMedal } from './podium'

describe('podiumMedal', () => {
  test('medals the top three only', () => {
    expect([1, 2, 3, 4].map(podiumMedal)).toEqual(['🏆', '🥈', '🥉', null])
  })
})

describe('competitionRanks', () => {
  test('numbers a strictly ordered leaderboard 1..n', () => {
    expect(competitionRanks([300, 200, 100])).toEqual([1, 2, 3])
  })

  test('shares a rank on equal totals and skips the next one', () => {
    expect(competitionRanks([100, 100, 90, 90, 80])).toEqual([1, 1, 3, 3, 5])
    expect(competitionRanks([])).toEqual([])
  })
})
