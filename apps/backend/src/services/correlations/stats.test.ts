import { describe, expect, test } from 'vitest'

import {
  chiSquared2x2,
  chiSquaredPValue1df,
  cohensD,
  erfc,
  fisherExact2x2,
  mannWhitneyU,
  pearson,
  regularizedIncompleteBeta,
  riskRatio,
  significance2x2,
  spearman,
  studentTTwoSidedP,
  twoGroupComparison,
  welchTTest,
} from './stats.ts'

describe('erfc', () => {
  test('matches known values', () => {
    expect(erfc(0)).toBeCloseTo(1, 5)
    expect(erfc(1)).toBeCloseTo(0.1572992, 4)
    expect(erfc(-1)).toBeCloseTo(1.8427008, 4)
  })
})

describe('chiSquaredPValue1df', () => {
  test('critical value 3.841 gives p ~= 0.05', () => {
    expect(chiSquaredPValue1df(3.841)).toBeCloseTo(0.05, 3)
  })

  test('critical value 6.635 gives p ~= 0.01', () => {
    expect(chiSquaredPValue1df(6.635)).toBeCloseTo(0.01, 3)
  })

  test('zero statistic gives p = 1', () => {
    expect(chiSquaredPValue1df(0)).toBe(1)
  })
})

describe('chiSquared2x2', () => {
  test('computes Pearson statistic', () => {
    // a=10,b=10,c=5,d=20: expected a=6.667 -> chi^2 = 4.5 (no continuity correction)
    expect(chiSquared2x2({ a: 10, b: 10, c: 5, d: 20 })).toBeCloseTo(4.5, 5)
  })

  test('null for empty table', () => {
    expect(chiSquared2x2({ a: 0, b: 0, c: 0, d: 0 })).toBeNull()
  })
})

describe('fisherExact2x2', () => {
  test('classic tea-tasting table (3,1,1,3) two-sided p ~= 0.486', () => {
    expect(fisherExact2x2({ a: 3, b: 1, c: 1, d: 3 })).toBeCloseTo(0.4857, 3)
  })

  test('strong association gives small p', () => {
    expect(fisherExact2x2({ a: 10, b: 0, c: 0, d: 10 })).toBeLessThan(0.001)
  })

  test('empty table gives p = 1', () => {
    expect(fisherExact2x2({ a: 0, b: 0, c: 0, d: 0 })).toBe(1)
  })
})

describe('significance2x2', () => {
  test('uses Fisher when an expected cell is small', () => {
    const result = significance2x2({ a: 3, b: 1, c: 1, d: 3 })
    expect(result.test).toBe('fisher')
    expect(result.chi_squared).toBeNull()
  })

  test('uses chi-squared when all expected cells are large', () => {
    const result = significance2x2({ a: 30, b: 30, c: 15, d: 45 })
    expect(result.test).toBe('chi_squared')
    expect(result.chi_squared).not.toBeNull()
  })
})

describe('riskRatio', () => {
  test('computes RR and a finite CI for a clear effect', () => {
    // exposed: 20/100 = 0.2; unexposed: 10/100 = 0.1; RR = 2
    const result = riskRatio({ a: 20, b: 80, c: 10, d: 90 })
    expect(result.relative_risk).toBeCloseTo(2, 5)
    expect(result.risk_difference).toBeCloseTo(0.1, 5)
    expect(result.ci_low).not.toBeNull()
    expect(result.ci_high).not.toBeNull()
    expect(result.ci_low!).toBeLessThan(2)
    expect(result.ci_high!).toBeGreaterThan(2)
  })

  test('RR null when no unexposed outcomes', () => {
    const result = riskRatio({ a: 5, b: 5, c: 0, d: 10 })
    expect(result.relative_risk).toBeNull()
  })

  test('CI null when an outcome count is zero', () => {
    const result = riskRatio({ a: 0, b: 10, c: 5, d: 5 })
    expect(result.relative_risk).toBe(0)
    expect(result.ci_low).toBeNull()
  })
})

describe('pearson', () => {
  test('perfect positive correlation', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 5)
  })

  test('null for constant input (no variance)', () => {
    expect(pearson([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull()
  })
})

describe('spearman', () => {
  test('monotonic-but-nonlinear gives 1', () => {
    expect(spearman([1, 2, 3, 4], [1, 4, 9, 16])).toBeCloseTo(1, 5)
  })

  test('handles ties', () => {
    const result = spearman([1, 2, 2, 3], [1, 2, 3, 4])
    expect(result).not.toBeNull()
    expect(result!).toBeGreaterThan(0.8)
  })
})

describe('regularizedIncompleteBeta', () => {
  test('symmetric I_0.5(a, a) = 0.5', () => {
    expect(regularizedIncompleteBeta(0.5, 2, 2)).toBeCloseTo(0.5, 6)
    expect(regularizedIncompleteBeta(0.5, 1, 1)).toBeCloseTo(0.5, 6)
  })

  test('saturates at the bounds', () => {
    expect(regularizedIncompleteBeta(0, 2, 3)).toBe(0)
    expect(regularizedIncompleteBeta(1, 2, 3)).toBe(1)
  })
})

describe('studentTTwoSidedP', () => {
  test('t = 0 gives p = 1', () => {
    expect(studentTTwoSidedP(0, 10)).toBeCloseTo(1, 6)
  })

  test('matches t-table critical values (df=10, t=2.228 -> 0.05)', () => {
    expect(studentTTwoSidedP(2.228, 10)).toBeCloseTo(0.05, 3)
  })

  test('approaches the normal 1.96 -> 0.05 at high df', () => {
    expect(studentTTwoSidedP(1.96, 100000)).toBeCloseTo(0.05, 3)
  })
})

describe('welchTTest', () => {
  test('clearly separated groups: t and df match the hand calculation', () => {
    // A mean 3, B mean 8, both sample var 2.5, n=5 -> t=-5, df=8.
    const result = welchTTest([1, 2, 3, 4, 5], [6, 7, 8, 9, 10])
    expect(result).not.toBeNull()
    expect(result!.t).toBeCloseTo(-5, 5)
    expect(result!.df).toBeCloseTo(8, 5)
    expect(result!.p_value).toBeLessThan(0.01)
  })

  test('identical groups give t ~= 0 and p ~= 1', () => {
    const result = welchTTest([4, 5, 6, 7], [4, 5, 6, 7])
    expect(result!.t).toBeCloseTo(0, 6)
    expect(result!.p_value).toBeCloseTo(1, 6)
  })

  test('null when a group has fewer than two values', () => {
    expect(welchTTest([1], [2, 3, 4])).toBeNull()
  })
})

describe('mannWhitneyU', () => {
  test('fully separated (A below B) gives U=0 and rank-biserial -1', () => {
    const result = mannWhitneyU([1, 2, 3], [4, 5, 6])
    expect(result!.u).toBe(0)
    expect(result!.rank_biserial).toBeCloseTo(-1, 6)
  })

  test('fully separated (A above B) gives rank-biserial +1', () => {
    const result = mannWhitneyU([4, 5, 6], [1, 2, 3])
    expect(result!.u).toBe(9)
    expect(result!.rank_biserial).toBeCloseTo(1, 6)
  })

  test('null when a group is empty', () => {
    expect(mannWhitneyU([], [1, 2])).toBeNull()
  })
})

describe('cohensD', () => {
  test('matches the hand calculation', () => {
    // means 3 vs 8, pooled var 2.5 -> d = -5/sqrt(2.5) = -3.162.
    expect(cohensD([1, 2, 3, 4, 5], [6, 7, 8, 9, 10])).toBeCloseTo(-3.1623, 3)
  })

  test('null when not estimable', () => {
    expect(cohensD([1], [2, 3])).toBeNull()
  })
})

describe('twoGroupComparison', () => {
  test('reports means, difference and effect sizes', () => {
    const result = twoGroupComparison([10, 11, 12], [1, 2, 3])
    expect(result.n_with).toBe(3)
    expect(result.n_without).toBe(3)
    expect(result.mean_with).toBeCloseTo(11, 6)
    expect(result.mean_without).toBeCloseTo(2, 6)
    expect(result.difference).toBeCloseTo(9, 6)
    expect(result.cohens_d!).toBeGreaterThan(2)
    expect(result.welch!.t).toBeGreaterThan(0)
    expect(result.mann_whitney!.rank_biserial).toBeCloseTo(1, 6)
  })

  test('handles empty groups without throwing', () => {
    const result = twoGroupComparison([], [1, 2, 3])
    expect(result.mean_with).toBeNull()
    expect(result.difference).toBeNull()
    expect(result.welch).toBeNull()
    expect(result.mann_whitney).toBeNull()
  })
})
