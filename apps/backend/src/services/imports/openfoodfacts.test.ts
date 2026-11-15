import { AxiosError, type AxiosResponse } from 'axios'
import { readFileSync } from 'node:fs'
import { describe, expect, test, vi } from 'vitest'

import type { InsertSharedFoodItemInput, SharedFoodItemEntity } from '../central-food-items.ts'

import {
  buildOffSharedFoodItemInput,
  createOffFetchGuard,
  fetchOffProduct,
  lookupFoodByBarcode,
  mapOffProductToColumns,
  normalizeBarcode,
  OFF_REFRESH_AFTER_MS,
  OFF_SOURCE,
  type OffFetchResult,
  type OffProduct,
  offProductSchema,
} from './openfoodfacts.ts'

const fixture = (code: string): { product: unknown } =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/off-${code}.json`, import.meta.url), 'utf8'))

const nutella = offProductSchema.parse(fixture('3017624010701').product)
const cruesli = offProductSchema.parse(fixture('3168930010265').product)

describe('normalizeBarcode', () => {
  test('keeps an EAN-13 as typed', () => {
    expect(normalizeBarcode('3017624010701')).toBe('3017624010701')
  })

  test('strips spaces and hyphens', () => {
    expect(normalizeBarcode(' 3017 6240-10701 ')).toBe('3017624010701')
  })

  test('pads a UPC-A to its EAN-13 form, as OFF does', () => {
    expect(normalizeBarcode('049000028911')).toBe('0049000028911')
    expect(normalizeBarcode('0049000028911')).toBe('0049000028911')
  })

  test('keeps an EAN-8 at 8 digits', () => {
    expect(normalizeBarcode('96385074')).toBe('96385074')
  })

  test('drops the leading zero of a GTIN-14 that wraps an EAN-13', () => {
    expect(normalizeBarcode('03017624010701')).toBe('3017624010701')
    expect(normalizeBarcode('13017624010701')).toBe('13017624010701')
  })

  test('rejects anything but 8 to 14 digits', () => {
    expect(normalizeBarcode('1234567')).toBeNull()
    expect(normalizeBarcode('123456789012345')).toBeNull()
    expect(normalizeBarcode('30176240107ab')).toBeNull()
    expect(normalizeBarcode('../../etc/passwd')).toBeNull()
    expect(normalizeBarcode('')).toBeNull()
  })
})

describe('mapOffProductToColumns', () => {
  test('maps a complete product (recorded OFF response)', () => {
    const mapped = mapOffProductToColumns(nutella, '3017624010701')
    expect(mapped.name).toBe('Nutella (Ferrero)')
    expect(mapped.default_quantity).toBe(100)
    expect(mapped.default_unit).toBe('g')
    expect(mapped.default_log_quantity).toBeUndefined()
    expect(mapped.nutrient_data_incomplete).toBe(false)
    expect(mapped.columns).toMatchObject({
      calories: 539,
      carbs: 57.5,
      fat: 30.9,
      protein: 6.3,
      salt: 0.1075,
      saturated_fat: 10.6,
      sodium: 43,
      sugars: 56.3,
    })
  })

  test('converts minerals from grams to the column unit and takes the serving as the log default', () => {
    const mapped = mapOffProductToColumns(cruesli, '3168930010265')
    expect(mapped.name).toBe('cruesly mélange de noix (Cruesli)')
    expect(mapped.columns.iron).toBe(2.1)
    expect(mapped.columns.phosphorus).toBe(219)
    expect(mapped.columns.fiber).toBe(10)
    expect(mapped.default_log_quantity).toBe(45)
  })

  test('maps vitamins to µg and mg', () => {
    const mapped = mapOffProductToColumns(
      { nutriments: { 'vitamin-b12_100g': 0.0000025, 'vitamin-c_100g': 0.006, 'vitamin-d_100g': 0.000005 } },
      '12345678',
    )
    expect(mapped.columns.vitamin_c).toBe(6)
    expect(mapped.columns.vitamin_d).toBe(5)
    expect(mapped.columns.b12_cobalamin).toBe(2.5)
  })

  test('marks a sparse product incomplete', () => {
    const mapped = mapOffProductToColumns(
      { nutriments: { 'energy-kcal_100g': 120, fat_100g: 3 }, product_name: 'Bar' },
      '12345678',
    )
    expect(mapped.nutrient_data_incomplete).toBe(true)
    expect(mapped.columns).toEqual({ calories: 120, fat: 3 })
  })

  test('marks a product without energy incomplete even when the macros are there', () => {
    const mapped = mapOffProductToColumns(
      { nutriments: { carbohydrates_100g: 1, fat_100g: 1, proteins_100g: 1 } },
      '12345678',
    )
    expect(mapped.nutrient_data_incomplete).toBe(true)
  })

  test('falls back to kJ / 4.184 when kcal is missing', () => {
    const mapped = mapOffProductToColumns({ nutriments: { energy_100g: 418.4 } }, '12345678')
    expect(mapped.columns.calories).toBe(100)
  })

  test('derives salt from sodium and sodium from salt', () => {
    expect(mapOffProductToColumns({ nutriments: { sodium_100g: 0.4 } }, '12345678').columns.salt).toBe(1)
    expect(mapOffProductToColumns({ nutriments: { salt_100g: 1 } }, '12345678').columns.sodium).toBe(400)
  })

  test('ignores a serving in a unit other than the nutrient basis', () => {
    const mapped = mapOffProductToColumns(
      { nutriments: {}, serving_quantity: 330, serving_quantity_unit: 'ml' },
      '12345678',
    )
    expect(mapped.default_log_quantity).toBeUndefined()
  })

  test('stores a product sold by volume per 100 ml', () => {
    const mapped = mapOffProductToColumns(
      {
        nutrition_data_per: '100ml',
        nutriments: { 'energy-kcal_100ml': 42 },
        serving_quantity: 250,
        serving_quantity_unit: 'ml',
      },
      '12345678',
    )
    expect(mapped.default_unit).toBe('ml')
    expect(mapped.columns.calories).toBe(42)
    expect(mapped.default_log_quantity).toBe(250)
  })

  test('accepts numbers sent as strings and skips garbage', () => {
    const product = offProductSchema.parse({
      nutriments: { 'energy-kcal_100g': '250', proteins_100g: 'n/a' },
      serving_quantity: '30',
    })
    const mapped = mapOffProductToColumns(product, '12345678')
    expect(mapped.columns.calories).toBe(250)
    expect(mapped.columns.protein).toBeUndefined()
    expect(mapped.default_log_quantity).toBe(30)
  })

  test('names the product after the brand, then the barcode, when it has no name', () => {
    expect(mapOffProductToColumns({ brands: 'Acme' }, '12345678').name).toBe('Acme')
    expect(mapOffProductToColumns({}, '12345678').name).toBe('Product 12345678')
  })

  test('does not repeat a brand the name already carries', () => {
    expect(mapOffProductToColumns({ brands: 'Coca-Cola', product_name: 'Coca-Cola Zero' }, '1').name).toBe(
      'Coca-Cola Zero',
    )
  })
})

describe('buildOffSharedFoodItemInput', () => {
  test('keys the row on the barcode and stamps the fetch time', () => {
    const fetchedAt = new Date('2026-11-01T00:00:00Z')
    const input = buildOffSharedFoodItemInput(nutella, '3017624010701', fetchedAt)
    expect(input).toMatchObject({
      calories: 539,
      last_fetched_at: fetchedAt,
      source: 'openfoodfacts',
      source_id: '3017624010701',
    })
  })
})

const response = (data: unknown): AxiosResponse => ({ data }) as AxiosResponse

describe('fetchOffProduct', () => {
  test('asks the v3 product endpoint with a named User-Agent and only the mapped fields', async () => {
    const get = vi.fn().mockResolvedValue(response(fixture('3017624010701')))
    const result = await fetchOffProduct('3017624010701', { baseUrl: 'https://off.test', get })
    expect(result.kind).toBe('found')
    const [url, config] = get.mock.calls[0]
    expect(url).toBe(
      'https://off.test/api/v3/product/3017624010701.json?fields=product_name,brands,serving_quantity,serving_quantity_unit,nutrition_data_per,nutriments',
    )
    expect(config.headers['User-Agent']).toMatch(/^Aurboda\/\S+ \(https:\/\/github\.com\/fiddur\/aurboda\)$/)
    expect(config.timeout).toBeGreaterThan(0)
  })

  test('a 404 from OFF is not found', async () => {
    const err = new AxiosError('Not found', '404', undefined, undefined, {
      data: { result: { id: 'product_not_found' } },
      status: 404,
    } as AxiosResponse)
    const get = vi.fn().mockRejectedValue(err)
    expect(await fetchOffProduct('12345678', { get })).toEqual({ kind: 'not_found' })
  })

  test('a product_not_found result is not found', async () => {
    const get = vi
      .fn()
      .mockResolvedValue(response({ result: { id: 'product_not_found' }, status: 'failure' }))
    expect(await fetchOffProduct('12345678', { get })).toEqual({ kind: 'not_found' })
  })

  test('an unexpected body throws', async () => {
    const get = vi.fn().mockResolvedValue(response('<html>maintenance</html>'))
    await expect(fetchOffProduct('12345678', { get })).rejects.toThrow()
  })

  test('a server error throws', async () => {
    const err = new AxiosError('Bad gateway', '502', undefined, undefined, { status: 502 } as AxiosResponse)
    await expect(fetchOffProduct('12345678', { get: vi.fn().mockRejectedValue(err) })).rejects.toThrow()
  })
})

const NOW = new Date('2026-11-15T12:00:00Z')

const sharedItem = (overrides: Partial<SharedFoodItemEntity> = {}): SharedFoodItemEntity => ({
  created_at: NOW,
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Nutella (Ferrero)',
  name_lower: 'nutella (ferrero)',
  nutrient_data_incomplete: false,
  source: OFF_SOURCE,
  source_id: '3017624010701',
  updated_at: NOW,
  ...overrides,
})

const fakeStore = (cached: SharedFoodItemEntity | null) => {
  const upserts: InsertSharedFoodItemInput[] = []
  return {
    store: {
      getSharedFoodItemsBySourceIds: vi.fn(async () => (cached ? [cached] : [])),
      upsertSharedFoodItem: vi.fn(async (input: InsertSharedFoodItemInput) => {
        upserts.push(input)
        return sharedItem({ last_fetched_at: input.last_fetched_at as Date, name: input.name })
      }),
    },
    upserts,
  }
}

const found = (product: OffProduct = nutella): OffFetchResult => ({ kind: 'found', product })

describe('lookupFoodByBarcode', () => {
  const quiet = () => undefined

  test('returns a fresh cached row without asking OFF', async () => {
    const cached = sharedItem({ last_fetched_at: new Date(NOW.getTime() - 24 * 3600 * 1000) })
    const { store } = fakeStore(cached)
    const fetchProduct = vi.fn()
    const result = await lookupFoodByBarcode('3017624010701', { fetchProduct, now: () => NOW, store })
    expect(result).toEqual({ item: cached, kind: 'found' })
    expect(fetchProduct).not.toHaveBeenCalled()
    expect(store.getSharedFoodItemsBySourceIds).toHaveBeenCalledWith([
      { source: 'openfoodfacts', source_id: '3017624010701' },
    ])
  })

  test('refetches a row older than 90 days and upserts it', async () => {
    const cached = sharedItem({ last_fetched_at: new Date(NOW.getTime() - OFF_REFRESH_AFTER_MS - 1) })
    const { store, upserts } = fakeStore(cached)
    const fetchProduct = vi.fn(async () => found())
    const result = await lookupFoodByBarcode('3017624010701', { fetchProduct, now: () => NOW, store })
    expect(result.kind).toBe('found')
    expect(fetchProduct).toHaveBeenCalledWith('3017624010701')
    expect(upserts[0]).toMatchObject({ last_fetched_at: NOW, source_id: '3017624010701' })
  })

  test('refetches a cached row that was never stamped', async () => {
    const { store } = fakeStore(sharedItem())
    const fetchProduct = vi.fn(async () => found())
    await lookupFoodByBarcode('3017624010701', { fetchProduct, now: () => NOW, store })
    expect(fetchProduct).toHaveBeenCalled()
  })

  test('returns the stale row when the refetch fails', async () => {
    const cached = sharedItem({ last_fetched_at: new Date(NOW.getTime() - OFF_REFRESH_AFTER_MS - 1) })
    const { store } = fakeStore(cached)
    const fetchProduct = vi.fn(async () => {
      throw new Error('ETIMEDOUT')
    })
    const result = await lookupFoodByBarcode('3017624010701', {
      fetchProduct,
      now: () => NOW,
      store,
      warn: quiet,
    })
    expect(result).toEqual({ item: cached, kind: 'found' })
    expect(store.upsertSharedFoodItem).not.toHaveBeenCalled()
  })

  test('a miss that OFF does not know is not found', async () => {
    const { store } = fakeStore(null)
    const result = await lookupFoodByBarcode('12345678', {
      fetchProduct: async () => ({ kind: 'not_found' }),
      now: () => NOW,
      store,
    })
    expect(result).toEqual({ kind: 'not_found' })
    expect(store.upsertSharedFoodItem).not.toHaveBeenCalled()
  })

  test('a miss while OFF is down is an upstream error', async () => {
    const { store } = fakeStore(null)
    const result = await lookupFoodByBarcode('12345678', {
      fetchProduct: async () => {
        throw new Error('ECONNREFUSED')
      },
      now: () => NOW,
      store,
      warn: quiet,
    })
    expect(result).toEqual({ kind: 'upstream_error' })
  })

  test('a miss is fetched, stored and returned', async () => {
    const { store, upserts } = fakeStore(null)
    const result = await lookupFoodByBarcode('3017 6240 10701', {
      fetchProduct: async () => found(),
      now: () => NOW,
      store,
    })
    expect(result.kind).toBe('found')
    expect(upserts).toHaveLength(1)
    expect(upserts[0]).toMatchObject({ calories: 539, name: 'Nutella (Ferrero)', source: 'openfoodfacts' })
  })

  test('an invalid barcode never reaches the store or OFF', async () => {
    const { store } = fakeStore(null)
    const fetchProduct = vi.fn()
    expect(await lookupFoodByBarcode('abc', { fetchProduct, store })).toEqual({ kind: 'invalid_barcode' })
    expect(store.getSharedFoodItemsBySourceIds).not.toHaveBeenCalled()
    expect(fetchProduct).not.toHaveBeenCalled()
  })

  test('answers busy when the process is already at its OFF fetch cap', async () => {
    const guard = createOffFetchGuard(1)
    let release: (r: OffFetchResult) => void = () => undefined
    void guard('11111111', () => new Promise<OffFetchResult>((resolve) => (release = resolve)))
    const { store } = fakeStore(null)
    const result = await lookupFoodByBarcode('12345678', { fetchProduct: async () => found(), guard, store })
    expect(result).toEqual({ kind: 'busy' })
    release({ kind: 'not_found' })
  })
})

describe('createOffFetchGuard', () => {
  test('concurrent lookups of one barcode share a request', async () => {
    const guard = createOffFetchGuard(1)
    const fetch = vi.fn(async (): Promise<OffFetchResult> => ({ kind: 'not_found' }))
    const [a, b] = await Promise.all([guard('12345678', fetch), guard('12345678', fetch)])
    expect(a).toEqual({ kind: 'not_found' })
    expect(b).toEqual({ kind: 'not_found' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('frees its slot when a request settles', async () => {
    const guard = createOffFetchGuard(1)
    await guard('11111111', async () => ({ kind: 'not_found' }))
    expect(await guard('22222222', async () => ({ kind: 'not_found' }))).toEqual({ kind: 'not_found' })
  })
})
