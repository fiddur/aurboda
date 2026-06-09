/**
 * Statistical primitives for correlation analysis.
 *
 * These are exact-ish numerical implementations used by the event-outcome and
 * continuous correlation engines. The previous p-value approximation
 * (`exp(-0.5 * chi^2)`) in utils.ts was wildly inaccurate (it returned ~0.146
 * at chi^2 = 3.84 instead of 0.05); these functions replace it.
 */

/** A 2x2 contingency table laid out in epidemiology convention. */
export interface ContingencyTable {
  /** exposed and outcome present */
  a: number
  /** exposed and outcome absent */
  b: number
  /** unexposed and outcome present */
  c: number
  /** unexposed and outcome absent */
  d: number
}

/** Relative-risk result with a Wald 95% confidence interval. */
export interface RiskRatioResult {
  /** Risk of outcome among exposed: a / (a + b) */
  risk_exposed: number
  /** Risk of outcome among unexposed: c / (c + d) */
  risk_unexposed: number
  /** risk_exposed / risk_unexposed (null when unexposed risk is 0) */
  relative_risk: number | null
  /** risk_exposed - risk_unexposed */
  risk_difference: number
  /** Lower bound of the 95% CI for relative risk (null when not estimable) */
  ci_low: number | null
  /** Upper bound of the 95% CI for relative risk (null when not estimable) */
  ci_high: number | null
}

/** Result of a 2x2 significance test. */
export interface SignificanceResult {
  /** Chi-squared statistic (null when Fisher's exact test was used) */
  chi_squared: number | null
  /** Two-sided p-value */
  p_value: number
  /** Which test produced the p-value */
  test: 'chi_squared' | 'fisher'
}

/**
 * Complementary error function, Abramowitz & Stegun 7.1.26.
 * Maximum absolute error ~1.5e-7, which is ample for p-values.
 */
export const erfc = (x: number): number => {
  const z = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * z)
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
  const erf = 1 - poly * Math.exp(-z * z)
  return x >= 0 ? 1 - erf : 1 + erf
}

/**
 * Two-sided p-value for a chi-squared statistic with 1 degree of freedom.
 *
 * For 1 df, P(X > c) = erfc(sqrt(c / 2)). At c = 3.841 this returns ~0.05.
 */
export const chiSquaredPValue1df = (chiSquared: number): number => {
  if (chiSquared <= 0) return 1
  return erfc(Math.sqrt(chiSquared / 2))
}

/**
 * Pearson chi-squared statistic for a 2x2 table (no continuity correction).
 * Returns null when the table is empty.
 */
export const chiSquared2x2 = ({ a, b, c, d }: ContingencyTable): number | null => {
  const total = a + b + c + d
  if (total === 0) return null

  const rowTotals = [a + b, c + d]
  const colTotals = [a + c, b + d]
  const observed = [
    [a, b],
    [c, d],
  ]

  let chiSquared = 0
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const expected = (rowTotals[i] * colTotals[j]) / total
      if (expected > 0) {
        chiSquared += (observed[i][j] - expected) ** 2 / expected
      }
    }
  }
  return chiSquared
}

/** Returns true when any expected cell count in the table is below 5. */
const hasSmallExpectedCell = ({ a, b, c, d }: ContingencyTable): boolean => {
  const total = a + b + c + d
  if (total === 0) return true
  const rowTotals = [a + b, c + d]
  const colTotals = [a + c, b + d]
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      if ((rowTotals[i] * colTotals[j]) / total < 5) return true
    }
  }
  return false
}

/** Lanczos approximation of ln(Γ(x)). */
export const logGamma = (x: number): number => {
  const g = 7
  const coef = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ]
  if (x < 0.5) {
    // Reflection formula
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
  }
  const z = x - 1
  let acc = coef[0]
  for (let i = 1; i < g + 2; i++) {
    acc += coef[i] / (z + i)
  }
  const t = z + g + 0.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(acc)
}

const logFactorial = (n: number): number => logGamma(n + 1)

/** ln of the binomial coefficient C(n, k). */
const logChoose = (n: number, k: number): number => {
  if (k < 0 || k > n) return -Infinity
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k)
}

/**
 * Hypergeometric probability of observing exactly `a` in the top-left cell of a
 * 2x2 table with the given margins.
 */
const hypergeometricProb = (a: number, row1: number, row2: number, col1: number): number => {
  const total = row1 + row2
  return Math.exp(logChoose(row1, a) + logChoose(row2, col1 - a) - logChoose(total, col1))
}

/**
 * Two-sided Fisher's exact test for a 2x2 table. Sums the probabilities of all
 * tables (with the same margins) that are no more likely than the observed one.
 */
export const fisherExact2x2 = ({ a, b, c, d }: ContingencyTable): number => {
  const row1 = a + b
  const row2 = c + d
  const col1 = a + c
  const total = row1 + row2
  if (total === 0) return 1

  const observedProb = hypergeometricProb(a, row1, row2, col1)
  const lo = Math.max(0, col1 - row2)
  const hi = Math.min(row1, col1)

  // Tolerance guards against floating-point ties being excluded.
  const tolerance = observedProb * 1e-7
  let pValue = 0
  for (let x = lo; x <= hi; x++) {
    const prob = hypergeometricProb(x, row1, row2, col1)
    if (prob <= observedProb + tolerance) pValue += prob
  }
  return Math.min(1, pValue)
}

/**
 * Significance test for a 2x2 table. Uses Fisher's exact test when any expected
 * cell count is below 5, otherwise Pearson's chi-squared.
 */
export const significance2x2 = (table: ContingencyTable): SignificanceResult => {
  if (hasSmallExpectedCell(table)) {
    return { chi_squared: null, p_value: fisherExact2x2(table), test: 'fisher' }
  }
  const chiSquared = chiSquared2x2(table) ?? 0
  return {
    chi_squared: chiSquared,
    p_value: chiSquaredPValue1df(chiSquared),
    test: 'chi_squared',
  }
}

/**
 * Relative risk and Wald 95% confidence interval from a 2x2 table.
 *
 * The CI uses the standard log-RR standard error
 * SE(ln RR) = sqrt(b / (a (a+b)) + d / (c (c+d))). It is null when either
 * outcome count (a or c) is zero, since the log SE is then undefined.
 */
export const riskRatio = ({ a, b, c, d }: ContingencyTable): RiskRatioResult => {
  const exposedTotal = a + b
  const unexposedTotal = c + d
  const riskExposed = exposedTotal > 0 ? a / exposedTotal : 0
  const riskUnexposed = unexposedTotal > 0 ? c / unexposedTotal : 0
  const relativeRisk = riskUnexposed > 0 ? riskExposed / riskUnexposed : null

  let ciLow: number | null = null
  let ciHigh: number | null = null
  if (relativeRisk !== null && a > 0 && c > 0) {
    const seLnRr = Math.sqrt(b / (a * exposedTotal) + d / (c * unexposedTotal))
    const lnRr = Math.log(relativeRisk)
    ciLow = Math.exp(lnRr - 1.96 * seLnRr)
    ciHigh = Math.exp(lnRr + 1.96 * seLnRr)
  }

  return {
    risk_exposed: riskExposed,
    risk_unexposed: riskUnexposed,
    relative_risk: relativeRisk,
    risk_difference: riskExposed - riskUnexposed,
    ci_low: ciLow,
    ci_high: ciHigh,
  }
}

/** Mean of an array, or null when empty. */
export const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length

/** Sample standard deviation, or null when fewer than 2 values. */
export const stddev = (values: number[]): number | null => {
  if (values.length < 2) return null
  const avg = mean(values)!
  const squareDiffs = values.map((v) => (v - avg) ** 2)
  return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / (values.length - 1))
}

/** Pearson correlation coefficient, or null when fewer than 3 pairs / no variance. */
export const pearson = (x: number[], y: number[]): number | null => {
  if (x.length !== y.length || x.length < 3) return null
  const meanX = mean(x)!
  const meanY = mean(y)!
  let num = 0
  let denomX = 0
  let denomY = 0
  for (let i = 0; i < x.length; i++) {
    const dx = x[i] - meanX
    const dy = y[i] - meanY
    num += dx * dy
    denomX += dx * dx
    denomY += dy * dy
  }
  const denom = Math.sqrt(denomX * denomY)
  return denom === 0 ? null : num / denom
}

/** Convert values to fractional ranks (ties share the average rank). */
const toRanks = (values: number[]): number[] => {
  const indexed = values.map((value, index) => ({ value, index }))
  indexed.sort((p, q) => p.value - q.value)
  const ranks = new Array<number>(values.length)
  let i = 0
  while (i < indexed.length) {
    let j = i
    while (j + 1 < indexed.length && indexed[j + 1].value === indexed[i].value) j++
    const avgRank = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) ranks[indexed[k].index] = avgRank
    i = j + 1
  }
  return ranks
}

/** Spearman rank correlation, or null when fewer than 3 pairs. */
export const spearman = (x: number[], y: number[]): number | null => {
  if (x.length !== y.length || x.length < 3) return null
  return pearson(toRanks(x), toRanks(y))
}

/** Sample variance (n-1 denominator), or null when fewer than 2 values. */
const sampleVariance = (values: number[]): number | null => {
  const sd = stddev(values)
  return sd === null ? null : sd * sd
}

/** Continued fraction for the incomplete beta function (Numerical Recipes betacf). */
const betacf = (x: number, a: number, b: number): number => {
  const MAX_ITER = 200
  const EPS = 3e-12
  const FPMIN = 1e-300
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return h
}

/** Regularized incomplete beta function I_x(a, b). */
export const regularizedIncompleteBeta = (x: number, a: number, b: number): number => {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const logBeta = logGamma(a + b) - logGamma(a) - logGamma(b)
  const front = Math.exp(logBeta + a * Math.log(x) + b * Math.log(1 - x))
  return x < (a + 1) / (a + b + 2) ? (front * betacf(x, a, b)) / a : 1 - (front * betacf(1 - x, b, a)) / b
}

/**
 * Two-sided p-value for a Student's t statistic with `df` degrees of freedom,
 * via P(|T| > |t|) = I_{df/(df+t²)}(df/2, 1/2).
 */
export const studentTTwoSidedP = (t: number, df: number): number => {
  if (df <= 0 || !Number.isFinite(t)) return 1
  return Math.min(1, regularizedIncompleteBeta(df / (df + t * t), df / 2, 0.5))
}

/** Welch's two-sample t-test (unequal variances). */
export interface WelchResult {
  /** t statistic (positive when group A's mean is higher). */
  t: number
  /** Welch–Satterthwaite degrees of freedom. */
  df: number
  /** Two-sided p-value. */
  p_value: number
}

/** Welch's t-test, or null when either group has fewer than 2 values / no variance. */
export const welchTTest = (groupA: number[], groupB: number[]): WelchResult | null => {
  if (groupA.length < 2 || groupB.length < 2) return null
  const varA = sampleVariance(groupA)!
  const varB = sampleVariance(groupB)!
  const na = groupA.length
  const nb = groupB.length
  const seA = varA / na
  const seB = varB / nb
  const seTotal = seA + seB
  if (seTotal === 0) return null
  const t = (mean(groupA)! - mean(groupB)!) / Math.sqrt(seTotal)
  const df = (seTotal * seTotal) / ((seA * seA) / (na - 1) + (seB * seB) / (nb - 1))
  return { t, df, p_value: studentTTwoSidedP(t, df) }
}

/** Mann–Whitney U test (normal approximation with tie correction). */
export interface MannWhitneyResult {
  /** U statistic for group A. */
  u: number
  /** Two-sided p-value. */
  p_value: number
  /** Rank-biserial effect size in [-1, 1] (positive when A tends to exceed B). */
  rank_biserial: number
}

/** Mann–Whitney U comparing groupA vs groupB, or null when either group is empty. */
export const mannWhitneyU = (groupA: number[], groupB: number[]): MannWhitneyResult | null => {
  const na = groupA.length
  const nb = groupB.length
  if (na === 0 || nb === 0) return null
  const combined = [...groupA, ...groupB]
  const ranks = toRanks(combined)
  let rankSumA = 0
  for (let i = 0; i < na; i++) rankSumA += ranks[i]
  const uA = rankSumA - (na * (na + 1)) / 2
  const rankBiserial = (2 * uA) / (na * nb) - 1

  const n = na + nb
  const mu = (na * nb) / 2
  const counts = new Map<number, number>()
  for (const v of combined) counts.set(v, (counts.get(v) ?? 0) + 1)
  let tieTerm = 0
  for (const t of counts.values()) tieTerm += t ** 3 - t
  const sigmaSq = ((na * nb) / 12) * (n + 1 - tieTerm / (n * (n - 1)))
  if (sigmaSq <= 0) return { u: uA, p_value: 1, rank_biserial: rankBiserial }
  const z = (uA - mu) / Math.sqrt(sigmaSq)
  return { u: uA, p_value: Math.min(1, erfc(Math.abs(z) / Math.SQRT2)), rank_biserial: rankBiserial }
}

/** Cohen's d (pooled standard deviation), or null when not estimable. */
export const cohensD = (groupA: number[], groupB: number[]): number | null => {
  if (groupA.length < 2 || groupB.length < 2) return null
  const na = groupA.length
  const nb = groupB.length
  const varA = sampleVariance(groupA)!
  const varB = sampleVariance(groupB)!
  const pooledVar = ((na - 1) * varA + (nb - 1) * varB) / (na + nb - 2)
  if (pooledVar <= 0) return null
  return (mean(groupA)! - mean(groupB)!) / Math.sqrt(pooledVar)
}

/** Comparison of a continuous outcome split into two groups (e.g. by a binary trigger). */
export interface TwoGroupComparison {
  n_with: number
  n_without: number
  mean_with: number | null
  mean_without: number | null
  /** mean_with − mean_without. */
  difference: number | null
  /** Cohen's d (pooled). */
  cohens_d: number | null
  welch: WelchResult | null
  mann_whitney: MannWhitneyResult | null
}

/**
 * Compare a continuous outcome between the "trigger present" and "trigger
 * absent" groups: group means, their difference, Cohen's d, a Welch t-test and
 * a Mann–Whitney U test. This answers "how much does X change Y?" — the
 * question a Pearson r on a binary trigger can't.
 */
export const twoGroupComparison = (withValues: number[], withoutValues: number[]): TwoGroupComparison => {
  const meanWith = mean(withValues)
  const meanWithout = mean(withoutValues)
  return {
    n_with: withValues.length,
    n_without: withoutValues.length,
    mean_with: meanWith,
    mean_without: meanWithout,
    difference: meanWith !== null && meanWithout !== null ? meanWith - meanWithout : null,
    cohens_d: cohensD(withValues, withoutValues),
    welch: welchTTest(withValues, withoutValues),
    mann_whitney: mannWhitneyU(withValues, withoutValues),
  }
}
