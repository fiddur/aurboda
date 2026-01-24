/**
 * Geocoding service using Nominatim OpenStreetMap API.
 *
 * Handles reverse geocoding (coordinates -> address) with proper
 * rate limiting and address formatting.
 */

// ============================================================================
// Types
// ============================================================================

export interface NominatimAddress {
  house_number?: string
  road?: string
  neighbourhood?: string
  suburb?: string
  city?: string
  town?: string
  village?: string
  hamlet?: string
  municipality?: string
  county?: string
  state?: string
  postcode?: string
  country?: string
  country_code?: string
}

export interface NominatimResponse {
  place_id: number
  licence: string
  osm_type: string
  osm_id: number
  lat: string
  lon: string
  display_name: string
  address: NominatimAddress
  boundingbox: string[]
}

export interface GeocodingResult {
  address: string
  displayName: string
  raw: NominatimAddress
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_NOMINATIM_URL = 'https://nominatim.openstreetmap.org'
const USER_AGENT = 'Aurboda/1.0 (https://aurboda.net)'

// ============================================================================
// Address Formatting (pure functions, testable)
// ============================================================================

/**
 * Format a Nominatim address into a short, human-readable string.
 * Prioritizes street address, falls back to neighborhood/suburb.
 */
export const formatAddress = (address: NominatimAddress): string => {
  const parts: string[] = []

  // Primary location: street address or POI
  if (address.road) {
    if (address.house_number) {
      parts.push(`${address.road} ${address.house_number}`)
    } else {
      parts.push(address.road)
    }
  } else if (address.neighbourhood) {
    parts.push(address.neighbourhood)
  } else if (address.suburb) {
    parts.push(address.suburb)
  }

  // Secondary location: city/town/village
  const locality = address.city || address.town || address.village || address.hamlet || address.municipality
  if (locality && !parts.includes(locality)) {
    parts.push(locality)
  }

  // If we still have nothing, use county or country
  if (parts.length === 0) {
    if (address.county) {
      parts.push(address.county)
    } else if (address.country) {
      parts.push(address.country)
    }
  }

  return parts.join(', ')
}

/**
 * Format a Nominatim address into a longer display name.
 * Includes more detail than the short address.
 */
export const formatDisplayName = (address: NominatimAddress): string => {
  const parts: string[] = []

  // Street address
  if (address.road) {
    if (address.house_number) {
      parts.push(`${address.road} ${address.house_number}`)
    } else {
      parts.push(address.road)
    }
  }

  // Neighborhood/suburb
  if (address.neighbourhood) {
    parts.push(address.neighbourhood)
  } else if (address.suburb) {
    parts.push(address.suburb)
  }

  // City
  const locality = address.city || address.town || address.village || address.hamlet || address.municipality
  if (locality) {
    parts.push(locality)
  }

  // Country (if international context useful)
  if (address.country && parts.length < 3) {
    parts.push(address.country)
  }

  return parts.join(', ')
}

// ============================================================================
// Nominatim API Client
// ============================================================================

export interface ReverseGeocodeOptions {
  nominatimUrl?: string
  zoom?: number // 0-18, higher = more detail
}

/**
 * Reverse geocode coordinates to an address using Nominatim.
 *
 * Note: Nominatim requires max 1 request per second.
 * This function does not implement rate limiting - use geocode-queue for that.
 */
export const reverseGeocode = async (
  lat: number,
  lon: number,
  options: ReverseGeocodeOptions = {},
): Promise<GeocodingResult | null> => {
  const { nominatimUrl = process.env.NOMINATIM_URL || DEFAULT_NOMINATIM_URL, zoom = 18 } = options

  const url = new URL('/reverse', nominatimUrl)
  url.searchParams.set('format', 'json')
  url.searchParams.set('lat', lat.toString())
  url.searchParams.set('lon', lon.toString())
  url.searchParams.set('zoom', zoom.toString())
  url.searchParams.set('addressdetails', '1')

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    })

    if (!response.ok) {
      console.error(`Nominatim request failed: ${response.status} ${response.statusText}`)
      return null
    }

    const data = (await response.json()) as NominatimResponse

    if (!data.address) {
      console.warn(`Nominatim returned no address for ${lat}, ${lon}`)
      return null
    }

    return {
      address: formatAddress(data.address),
      displayName: formatDisplayName(data.address),
      raw: data.address,
    }
  } catch (error) {
    console.error('Nominatim geocoding error:', error)
    return null
  }
}
