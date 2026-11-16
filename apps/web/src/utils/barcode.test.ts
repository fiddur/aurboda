import { describe, expect, test } from 'vitest'

import { barcodeFromText, barcodeLookupErrorMessage, openFoodFactsProductUrl } from './barcode'

describe('barcodeFromText', () => {
  test('recognises 8 to 14 digits', () => {
    expect(barcodeFromText('96385074')).toBe('96385074')
    expect(barcodeFromText('049000028911')).toBe('049000028911')
    expect(barcodeFromText('3017624010701')).toBe('3017624010701')
    expect(barcodeFromText('13017624010701')).toBe('13017624010701')
  })

  test('ignores surrounding whitespace, inner spaces and hyphens', () => {
    expect(barcodeFromText('  3 017620 422003 ')).toBe('3017620422003')
    expect(barcodeFromText('3017-6240-10701')).toBe('3017624010701')
  })

  test('is null for food names and wrong lengths', () => {
    expect(barcodeFromText('nutella')).toBeNull()
    expect(barcodeFromText('7 up')).toBeNull()
    expect(barcodeFromText('1234567')).toBeNull()
    expect(barcodeFromText('123456789012345')).toBeNull()
    expect(barcodeFromText('3017624010701x')).toBeNull()
    expect(barcodeFromText('')).toBeNull()
  })
})

describe('openFoodFactsProductUrl', () => {
  test('links the product page', () => {
    expect(openFoodFactsProductUrl('3017624010701')).toBe(
      'https://world.openfoodfacts.org/product/3017624010701',
    )
  })
})

describe('barcodeLookupErrorMessage', () => {
  test('words each failure plainly', () => {
    expect(barcodeLookupErrorMessage(404, 'No product')).toMatch(/no product with this barcode/i)
    expect(barcodeLookupErrorMessage(400, { barcode: ['bad'] })).toMatch(/not a barcode/i)
    expect(
      barcodeLookupErrorMessage(502, 'Open Food Facts could not be reached. Try again in a moment.'),
    ).toBe('Open Food Facts could not be reached. Try again in a moment.')
    expect(barcodeLookupErrorMessage(500, undefined)).toMatch(/failed/i)
  })
})
