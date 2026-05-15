import { describe, expect, test } from 'vitest'

import { withDerivedNutrients } from './derived-nutrients.ts'

describe('withDerivedNutrients', () => {
  test('passes through a row with no derivable inputs', () => {
    expect(withDerivedNutrients({ calories: 100, protein: 10 })).toEqual({
      calories: 100,
      protein: 10,
    })
  })

  test('derives vitamin_a (RAE) from retinol + beta_carotene/12 when vitamin_a is null', () => {
    // 580 µg retinol + 6720 µg β-carotene → 580 + 560 = 1140 µg RAE
    const out = withDerivedNutrients({ retinol: 580, beta_carotene: 6720 })
    expect(out.vitamin_a).toBeCloseTo(1140)
    expect(out.retinol).toBe(580)
    expect(out.beta_carotene).toBe(6720)
  })

  test('vitamin_a explicit value wins (no double-counting against precursors)', () => {
    const out = withDerivedNutrients({ vitamin_a: 50, retinol: 580, beta_carotene: 6720 })
    expect(out.vitamin_a).toBe(50)
  })

  test('vitamin_a derives from a single precursor when the other is missing', () => {
    expect(withDerivedNutrients({ retinol: 200 }).vitamin_a).toBe(200)
    expect(withDerivedNutrients({ beta_carotene: 1200 }).vitamin_a).toBe(100)
  })

  test('derives niacin_equivalents from b3_niacin (mg) + tryptophan (g)/60', () => {
    // 8 mg niacin + 0.6 g tryptophan → 8 + (600/60) = 18 mg NE
    const out = withDerivedNutrients({ b3_niacin: 8, tryptophan: 0.6 })
    expect(out.niacin_equivalents).toBeCloseTo(18)
  })

  test('niacin_equivalents explicit value wins', () => {
    const out = withDerivedNutrients({ niacin_equivalents: 14, b3_niacin: 8, tryptophan: 0.6 })
    expect(out.niacin_equivalents).toBe(14)
  })

  test('cross-fills sodium from salt when sodium is missing', () => {
    // 5 g salt → 2000 mg sodium
    expect(withDerivedNutrients({ salt: 5 }).sodium).toBeCloseTo(2000)
  })

  test('cross-fills salt from sodium when salt is missing', () => {
    // 2000 mg sodium → 5 g salt
    expect(withDerivedNutrients({ sodium: 2000 }).salt).toBeCloseTo(5)
  })

  test('keeps both salt and sodium when both are explicit', () => {
    const out = withDerivedNutrients({ sodium: 2000, salt: 5 })
    expect(out.sodium).toBe(2000)
    expect(out.salt).toBe(5)
  })

  test('uses vitamin_d_25oh as vitamin_d when vitamin_d is missing', () => {
    // LSV's VITD_x is the combined value already including 25-OH-D3 contribution.
    expect(withDerivedNutrients({ vitamin_d_25oh: 8 }).vitamin_d).toBe(8)
  })

  test('vitamin_d explicit value wins over vitamin_d_25oh', () => {
    expect(withDerivedNutrients({ vitamin_d: 5, vitamin_d_25oh: 8 }).vitamin_d).toBe(5)
  })

  test('derives omega_3 from ala + epa + dha + dpa', () => {
    const out = withDerivedNutrients({ ala: 1.2, epa: 0.3, dha: 0.5, dpa: 0.1 })
    expect(out.omega_3).toBeCloseTo(2.1)
  })

  test('omega_3 explicit value wins', () => {
    expect(withDerivedNutrients({ omega_3: 5, ala: 1.2, epa: 0.3 }).omega_3).toBe(5)
  })

  test('derives omega_6 from la + aa', () => {
    expect(withDerivedNutrients({ la: 3, aa: 0.1 }).omega_6).toBeCloseTo(3.1)
  })

  test('derives net_carbs from carbs - fiber (clamped at zero)', () => {
    expect(withDerivedNutrients({ carbs: 40, fiber: 5 }).net_carbs).toBe(35)
    expect(withDerivedNutrients({ carbs: 5, fiber: 10 }).net_carbs).toBe(0)
  })

  test('net_carbs requires carbs to be set', () => {
    // No carbs → cannot derive (fiber alone tells us nothing)
    expect(withDerivedNutrients({ fiber: 5 }).net_carbs).toBeUndefined()
  })

  test('derives sugars from monosaccharides + disaccharides', () => {
    expect(withDerivedNutrients({ monosaccharides: 8, disaccharides: 12 }).sugars).toBe(20)
  })

  test('preserves zero values as explicit (does not override with derivation)', () => {
    // vitamin_a explicitly 0 should stay 0 — user/data source said zero.
    const out = withDerivedNutrients({ vitamin_a: 0, retinol: 100, beta_carotene: 1200 })
    expect(out.vitamin_a).toBe(0)
  })

  test('ignores undefined/null source fields without throwing', () => {
    const out = withDerivedNutrients({
      retinol: 100,
      beta_carotene: null as unknown as number,
    })
    expect(out.vitamin_a).toBe(100)
  })

  test('chained derivation: salt fills sodium then is not double-derived', () => {
    // Make sure we don't loop: salt set, sodium null → derive sodium, then leave salt alone.
    const out = withDerivedNutrients({ salt: 5 })
    expect(out.salt).toBe(5)
    expect(out.sodium).toBeCloseTo(2000)
  })

  test('numeric strings or non-numbers in row are ignored', () => {
    const out = withDerivedNutrients({
      retinol: 'bad' as unknown as number,
      beta_carotene: 1200,
    })
    expect(out.vitamin_a).toBe(100)
  })
})
