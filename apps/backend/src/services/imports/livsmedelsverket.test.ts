import { describe, expect, test } from 'vitest'

import {
  fetchLivsmedelsverketCatalog,
  fetchLivsmedelsverketFoodNutrients,
  type LsvNutrient,
  mapLsvNutrientsToColumns,
} from './livsmedelsverket.ts'

const nutrient = (euroFIRkod: string, varde: number, enhet: string): LsvNutrient => ({
  enhet,
  euroFIRkod,
  varde,
  viktGram: 100,
})

describe('mapLsvNutrientsToColumns', () => {
  test('takes the kcal duplicate of ENERC, drops kJ', () => {
    const { columns, unitMismatches } = mapLsvNutrientsToColumns([
      nutrient('ENERC', 2745, 'kJ'),
      nutrient('ENERC', 656, 'kcal'),
    ])
    expect(columns.calories).toBe(656)
    expect(unitMismatches).toHaveLength(0)
  })

  test('maps macro/fat/vitamin/mineral codes to our columns', () => {
    const { columns, unitMismatches } = mapLsvNutrientsToColumns([
      nutrient('PROT', 7.0, 'g'),
      nutrient('CHO', 0.5, 'g'),
      nutrient('FAT', 70.5, 'g'),
      nutrient('FIBT', 0, 'g'),
      nutrient('FASAT', 35, 'g'),
      nutrient('F22:6', 0.04, 'g'),
      nutrient('VITA', 25, 'µg'),
      nutrient('CA', 12, 'mg'),
      nutrient('SE', 7, 'µg'),
    ])
    expect(columns.protein).toBe(7)
    expect(columns.carbs).toBe(0.5)
    expect(columns.fat).toBe(70.5)
    expect(columns.fiber).toBe(0)
    expect(columns.saturated_fat).toBe(35)
    expect(columns.dha).toBe(0.04)
    expect(columns.vitamin_a).toBe(25)
    expect(columns.calcium).toBe(12)
    expect(columns.selenium).toBe(7)
    expect(unitMismatches).toHaveLength(0)
  })

  test('converts mg→µg when the column expects µg, but flags it as a mismatch', () => {
    const { columns, unitMismatches } = mapLsvNutrientsToColumns([nutrient('VITD', 1, 'mg')])
    expect(columns.vitamin_d).toBe(1000)
    // The runner uses unitMismatches to log loudly — silently producing
    // 1000-µg-of-vitamin-D values would look plausible and go unnoticed.
    expect(unitMismatches).toEqual([{ column: 'vitamin_d', fromUnit: 'mg', toUnit: 'µg' }])
  })

  test('skips unknown codes', () => {
    const { columns } = mapLsvNutrientsToColumns([nutrient('UNKNOWN_XYZ', 99, 'g'), nutrient('PROT', 7, 'g')])
    expect(columns.protein).toBe(7)
    expect(Object.keys(columns)).toEqual(['protein'])
  })

  test('skips rows with non-mass units we cannot convert (e.g. RE, NE, %)', () => {
    const { columns } = mapLsvNutrientsToColumns([nutrient('VITA', 25, 'RE')])
    expect(columns.vitamin_a).toBeUndefined()
  })

  test('handles the alternate "μ" (Greek mu) glyph', () => {
    const { columns, unitMismatches } = mapLsvNutrientsToColumns([nutrient('VITA', 25, 'μg')])
    expect(columns.vitamin_a).toBe(25)
    // U+03BC and U+00B5 are equivalent — same unit, not a mismatch.
    expect(unitMismatches).toHaveLength(0)
  })

  test('maps thiamine via the actual LSV code THIACLHCL (regression: previously dropped)', () => {
    const { columns } = mapLsvNutrientsToColumns([nutrient('THIACLHCL', 0.04, 'mg')])
    expect(columns.b1_thiamine).toBe(0.04)
  })

  test('maps total folate via FOL (regression: we used FOLFD which LSV does not ship)', () => {
    const { columns } = mapLsvNutrientsToColumns([nutrient('FOL', 17, 'µg')])
    expect(columns.folate).toBe(17)
  })

  test('maps niacin equivalents (NIAEQ) and individual fatty acids', () => {
    const { columns } = mapLsvNutrientsToColumns([
      nutrient('NIAEQ', 1.5, 'mg'),
      nutrient('F12:0', 0.3, 'g'),
      nutrient('F16:0', 7.4, 'g'),
      nutrient('F18:1', 9.1, 'g'),
    ])
    expect(columns.niacin_equivalents).toBe(1.5)
    expect(columns.lauric_acid).toBe(0.3)
    expect(columns.palmitic_acid).toBe(7.4)
    expect(columns.oleic_acid).toBe(9.1)
  })

  test('maps the additional sugar / whole-grain breakdown', () => {
    const { columns } = mapLsvNutrientsToColumns([
      nutrient('SUCS', 0.5, 'g'),
      nutrient('SUGFR', 0.2, 'g'),
      nutrient('MNSAC', 0, 'g'),
      nutrient('DISAC', 0.5, 'g'),
      nutrient('WHOLET', 0, 'g'),
    ])
    expect(columns.sucrose).toBe(0.5)
    expect(columns.free_sugars).toBe(0.2)
    expect(columns.monosaccharides).toBe(0)
    expect(columns.disaccharides).toBe(0.5)
    expect(columns.whole_grain).toBe(0)
  })
})

describe('LSV HTTP client (mocked fetch)', () => {
  const realFood = {
    namn: 'Nöt talg',
    nummer: 1,
  }

  test('fetchLivsmedelsverketCatalog pages until count < limit', async () => {
    let call = 0
    const fakeFetch = (async () => {
      call++
      const offset = call === 1 ? 0 : 200
      const all = Array.from({ length: 250 }, (_, i) => ({
        namn: `Food ${i}`,
        nummer: i + 1,
      }))
      const slice = all.slice(offset, offset + 200)
      return new Response(
        JSON.stringify({
          _meta: { count: slice.length, limit: 200, offset, totalRecords: 250 },
          livsmedel: slice,
        }),
      )
    }) as unknown as typeof fetch

    const catalog = await fetchLivsmedelsverketCatalog({
      baseUrl: 'https://example.test/livsmedel',
      fetch: fakeFetch,
    })
    expect(catalog).toHaveLength(250)
    expect(call).toBe(2)
  })

  test('fetchLivsmedelsverketFoodNutrients returns the array shape', async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify([nutrient('PROT', 7, 'g')]))) as unknown as typeof fetch
    const nutrients = await fetchLivsmedelsverketFoodNutrients(realFood.nummer, {
      baseUrl: 'https://example.test/livsmedel',
      fetch: fakeFetch,
    })
    expect(nutrients).toHaveLength(1)
    expect(nutrients[0].euroFIRkod).toBe('PROT')
  })

  test('throws on non-OK response', async () => {
    const fakeFetch = (async () =>
      new Response('boom', { status: 502, statusText: 'Bad Gateway' })) as unknown as typeof fetch
    await expect(
      fetchLivsmedelsverketFoodNutrients(1, {
        baseUrl: 'https://example.test/livsmedel',
        fetch: fakeFetch,
      }),
    ).rejects.toThrow(/502/)
  })
})
