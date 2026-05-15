/**
 * Compute derived nutrient values from precursor fields when the explicit
 * field is missing. Applied at meal-totals aggregation so the derivation
 * cascades into daily/weekly/90d/baseline & dashboard widgets without
 * touching canonical food-item rows.
 *
 * Each rule fills a *single* nutrient from components if (and only if) the
 * explicit field is null/undefined — a value of 0 is treated as an explicit
 * "this food has none of this", not as missing.
 */

type NutrientRow = Record<string, number | null | undefined | unknown>

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** True only when the field is genuinely absent — null/undefined/non-number. A literal 0 is explicit. */
const isMissing = (v: unknown): boolean => num(v) === undefined

/**
 * Sum of finite contributors; returns undefined when *none* of them are
 * present (so we don't fabricate a derived "0" from a row with no relevant
 * data — that would let derived nutrients show up everywhere, polluting
 * days_with_value diagnostics in the period summary).
 */
const sumPresent = (...values: unknown[]): number | undefined => {
  let total = 0
  let any = false
  for (const v of values) {
    const n = num(v)
    if (n === undefined) continue
    total += n
    any = true
  }
  return any ? total : undefined
}

// Vitamin A (RAE, µg) = retinol + β-carotene/12. LSV ships precursors but
// typically leaves the combined column null.
const deriveVitaminA = (out: Record<string, unknown>): void => {
  if (!isMissing(out.vitamin_a)) return
  const retinol = num(out.retinol)
  const bc = num(out.beta_carotene)
  if (retinol === undefined && bc === undefined) return
  out.vitamin_a = (retinol ?? 0) + (bc ?? 0) / 12
}

// Niacin equivalents (mg NE) = b3_niacin (mg) + tryptophan (g) / 60.
// Tryptophan column is grams; 1 mg NE ≡ 60 mg tryptophan ⇒ g × 1000 / 60.
const deriveNiacinEquivalents = (out: Record<string, unknown>): void => {
  if (!isMissing(out.niacin_equivalents)) return
  const niacin = num(out.b3_niacin)
  const trp = num(out.tryptophan)
  if (niacin === undefined && trp === undefined) return
  out.niacin_equivalents = (niacin ?? 0) + ((trp ?? 0) * 1000) / 60
}

// Salt ↔ sodium cross-fill. salt is g, sodium is mg; 1 g salt ≈ 400 mg
// sodium. Fill only one direction per call so an all-explicit row keeps
// both values intact.
const deriveSaltSodium = (out: Record<string, unknown>): void => {
  const saltExplicit = !isMissing(out.salt)
  const sodiumExplicit = !isMissing(out.sodium)
  if (!sodiumExplicit && saltExplicit) {
    out.sodium = (num(out.salt) ?? 0) * 400
  } else if (!saltExplicit && sodiumExplicit) {
    out.salt = (num(out.sodium) ?? 0) / 400
  }
}

// Vitamin D (µg): LSV's VITD_x (vitamin_d_25oh) is already the combined value
// including 25-OH-D3 contribution with their potency factor, so when the bare
// D3 column is null we adopt the inclusive value directly.
const deriveVitaminD = (out: Record<string, unknown>): void => {
  if (!isMissing(out.vitamin_d) || isMissing(out.vitamin_d_25oh)) return
  out.vitamin_d = num(out.vitamin_d_25oh)
}

const deriveOmega3 = (out: Record<string, unknown>): void => {
  if (!isMissing(out.omega_3)) return
  const s = sumPresent(out.ala, out.epa, out.dha, out.dpa)
  if (s !== undefined) out.omega_3 = s
}

const deriveOmega6 = (out: Record<string, unknown>): void => {
  if (!isMissing(out.omega_6)) return
  const s = sumPresent(out.la, out.aa)
  if (s !== undefined) out.omega_6 = s
}

// Net carbs (g) = carbs − fiber, clamped at 0. Requires carbs to be set —
// fiber alone doesn't tell us net carbs.
const deriveNetCarbs = (out: Record<string, unknown>): void => {
  if (!isMissing(out.net_carbs)) return
  const carbs = num(out.carbs)
  if (carbs === undefined) return
  const fiber = num(out.fiber) ?? 0
  out.net_carbs = Math.max(0, carbs - fiber)
}

const deriveSugars = (out: Record<string, unknown>): void => {
  if (!isMissing(out.sugars)) return
  const s = sumPresent(out.monosaccharides, out.disaccharides)
  if (s !== undefined) out.sugars = s
}

/**
 * Return a shallow copy of `row` with derived nutrient fields filled in when
 * the explicit column is missing. Non-nutrient fields on the row are passed
 * through untouched so callers can hand in a raw junction-row record.
 */
export const withDerivedNutrients = (row: NutrientRow): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...row }
  deriveVitaminA(out)
  deriveNiacinEquivalents(out)
  deriveSaltSodium(out)
  deriveVitaminD(out)
  deriveOmega3(out)
  deriveOmega6(out)
  deriveNetCarbs(out)
  deriveSugars(out)
  return out
}
