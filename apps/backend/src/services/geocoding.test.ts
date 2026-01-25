import { describe, expect, test } from 'vitest'
import { formatAddress, formatDisplayName, NominatimAddress } from './geocoding'

describe('formatAddress', () => {
  test('formats street address with house number', () => {
    const address: NominatimAddress = {
      city: 'Stockholm',
      country: 'Sweden',
      country_code: 'se',
      house_number: '5',
      postcode: '111 52',
      road: 'Storgatan',
    }

    expect(formatAddress(address)).toBe('Storgatan 5, Stockholm')
  })

  test('formats street address without house number', () => {
    const address: NominatimAddress = {
      city: 'Stockholm',
      country: 'Sweden',
      road: 'Storgatan',
    }

    expect(formatAddress(address)).toBe('Storgatan, Stockholm')
  })

  test('uses neighbourhood when no road', () => {
    const address: NominatimAddress = {
      city: 'Stockholm',
      country: 'Sweden',
      neighbourhood: 'Vasastan',
    }

    expect(formatAddress(address)).toBe('Vasastan, Stockholm')
  })

  test('uses suburb when no road or neighbourhood', () => {
    const address: NominatimAddress = {
      city: 'Stockholm',
      country: 'Sweden',
      suburb: 'Södermalm',
    }

    expect(formatAddress(address)).toBe('Södermalm, Stockholm')
  })

  test('uses town instead of city', () => {
    const address: NominatimAddress = {
      country: 'Sweden',
      road: 'Storgatan',
      town: 'Uppsala',
    }

    expect(formatAddress(address)).toBe('Storgatan, Uppsala')
  })

  test('uses village for rural areas', () => {
    const address: NominatimAddress = {
      country: 'Sweden',
      road: 'Byvägen',
      village: 'Björklinge',
    }

    expect(formatAddress(address)).toBe('Byvägen, Björklinge')
  })

  test('uses hamlet for very small settlements', () => {
    const address: NominatimAddress = {
      country: 'Sweden',
      hamlet: 'Lilla Byn',
      road: 'Landsvägen',
    }

    expect(formatAddress(address)).toBe('Landsvägen, Lilla Byn')
  })

  test('uses municipality as fallback locality', () => {
    const address: NominatimAddress = {
      country: 'Sweden',
      municipality: 'Upplands Väsby kommun',
      road: 'Stationsvägen',
    }

    expect(formatAddress(address)).toBe('Stationsvägen, Upplands Väsby kommun')
  })

  test('falls back to county when no other info', () => {
    const address: NominatimAddress = {
      country: 'Sweden',
      county: 'Stockholm County',
    }

    expect(formatAddress(address)).toBe('Stockholm County')
  })

  test('falls back to country when only country available', () => {
    const address: NominatimAddress = {
      country: 'Sweden',
    }

    expect(formatAddress(address)).toBe('Sweden')
  })

  test('returns empty string for empty address', () => {
    const address: NominatimAddress = {}

    expect(formatAddress(address)).toBe('')
  })

  test('does not duplicate locality in parts', () => {
    const address: NominatimAddress = {
      city: 'Stockholm',
      road: 'Stockholm', // Edge case: road named same as city
    }

    // Should not duplicate when road and city are the same
    expect(formatAddress(address)).toBe('Stockholm')
  })
})

describe('formatDisplayName', () => {
  test('includes street, neighbourhood and city', () => {
    const address: NominatimAddress = {
      city: 'Stockholm',
      country: 'Sweden',
      house_number: '5',
      neighbourhood: 'Norrmalm',
      road: 'Storgatan',
    }

    expect(formatDisplayName(address)).toBe('Storgatan 5, Norrmalm, Stockholm')
  })

  test('includes suburb when no neighbourhood', () => {
    const address: NominatimAddress = {
      city: 'Stockholm',
      country: 'Sweden',
      house_number: '5',
      road: 'Storgatan',
      suburb: 'Södermalm',
    }

    expect(formatDisplayName(address)).toBe('Storgatan 5, Södermalm, Stockholm')
  })

  test('includes country when less than 3 parts', () => {
    const address: NominatimAddress = {
      city: 'Stockholm',
      country: 'Sweden',
    }

    expect(formatDisplayName(address)).toBe('Stockholm, Sweden')
  })

  test('excludes country when 3+ parts', () => {
    const address: NominatimAddress = {
      city: 'Stockholm',
      country: 'Sweden',
      house_number: '5',
      neighbourhood: 'Norrmalm',
      road: 'Storgatan',
    }

    expect(formatDisplayName(address)).toBe('Storgatan 5, Norrmalm, Stockholm')
  })

  test('handles minimal address', () => {
    const address: NominatimAddress = {
      country: 'Sweden',
    }

    expect(formatDisplayName(address)).toBe('Sweden')
  })
})
