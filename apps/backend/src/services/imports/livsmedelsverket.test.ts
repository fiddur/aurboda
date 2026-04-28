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
    const columns = mapLsvNutrientsToColumns([nutrient('ENERC', 2745, 'kJ'), nutrient('ENERC', 656, 'kcal')])
    expect(columns.calories).toBe(656)
  })

  test('maps macro/fat/vitamin/mineral codes to our columns', () => {
    const columns = mapLsvNutrientsToColumns([
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
  })

  test('converts mg→µg when the column expects µg', () => {
    const columns = mapLsvNutrientsToColumns([nutrient('VITD', 1, 'mg')])
    // 1 mg vitamin_d = 1000 µg (the LSV API in practice reports µg, but
    // be defensive — bad-unit data shouldn't silently become wrong-magnitude).
    expect(columns.vitamin_d).toBe(1000)
  })

  test('skips unknown codes', () => {
    const columns = mapLsvNutrientsToColumns([nutrient('UNKNOWN_XYZ', 99, 'g'), nutrient('PROT', 7, 'g')])
    expect(columns.protein).toBe(7)
    expect(Object.keys(columns)).toEqual(['protein'])
  })

  test('skips rows with non-mass units we cannot convert (e.g. RE, NE, %)', () => {
    const columns = mapLsvNutrientsToColumns([nutrient('VITA', 25, 'RE')])
    // RE is a retinol-equivalents unit, not directly mass. Skip rather than
    // emit a wrong-magnitude value.
    expect(columns.vitamin_a).toBeUndefined()
  })

  test('handles the alternate "μ" (Greek mu) glyph', () => {
    const columns = mapLsvNutrientsToColumns([nutrient('VITA', 25, 'μg')])
    expect(columns.vitamin_a).toBe(25)
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
