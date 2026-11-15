import { BARCODE_PATTERN, stripBarcodeSeparators } from '@aurboda/api-spec'

/** The barcode digits when `text` is one (8 to 14 digits, spaces and hyphens allowed), else null. */
export const barcodeFromText = (text: string): string | null => {
  const digits = stripBarcodeSeparators(text.trim())
  return BARCODE_PATTERN.test(digits) ? digits : null
}

export const OPEN_FOOD_FACTS_SOURCE = 'openfoodfacts'

export const openFoodFactsProductUrl = (barcode: string): string =>
  `https://world.openfoodfacts.org/product/${encodeURIComponent(barcode)}`

/** A plain sentence for a failed barcode lookup, from the HTTP status and the server's error. */
export const barcodeLookupErrorMessage = (status: number, error: unknown): string => {
  if (status === 400) return 'That is not a barcode. A barcode is 8 to 14 digits.'
  if (status === 404) return 'Open Food Facts has no product with this barcode.'
  if (status === 401) return 'Your session has expired. Log in again.'
  if (typeof error === 'string' && error.length > 0) return error
  return 'The barcode lookup failed. Try again in a moment.'
}
