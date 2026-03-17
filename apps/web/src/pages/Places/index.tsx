import 'leaflet/dist/leaflet.css'
import './style.css'
import { signal } from '@preact/signals'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { endOfDay, format, formatISO, startOfDay, subDays } from 'date-fns'
import L from 'leaflet'
import { useLocation } from 'preact-iso'
import { useEffect, useRef, useState } from 'preact/hooks'

import type { PlaceVisit, StoredDetectedLocation } from '../../state/api'

import {
  addNamedLocation,
  fetchNamedLocations,
  fetchPlaceVisits,
  fetchStoredDetectedLocations,
  promoteDetectedLocation,
} from '../../state/api'

// Fix Leaflet default marker icon path issue with bundlers
// @ts-expect-error - Leaflet marker icon fix
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const selectedDate = signal(formatISO(new Date(), { representation: 'date' }))

export const Places = () => {
  const queryClient = useQueryClient()
  const { query } = useLocation()
  const initialNameRef = useRef<string | null>(null)

  // On mount: apply URL params for date and name
  useEffect(() => {
    const params = new URLSearchParams(query)
    const dateParam = params.get('date')
    const nameParam = params.get('name')
    if (dateParam) selectedDate.value = dateParam
    if (nameParam) initialNameRef.current = nameParam
  }, [])

  const start = startOfDay(new Date(selectedDate.value))
  const end = endOfDay(new Date(selectedDate.value))

  const [selectedPlace, setSelectedPlace] = useState<PlaceVisit | StoredDetectedLocation | null>(null)
  const [namingLocation, setNamingLocation] = useState<{
    lat: number
    lon: number
    address?: string
  } | null>(null)
  const [nameInput, setNameInput] = useState('')

  const mapRef = useRef<HTMLDivElement>(null)
  const leafletMapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)

  const placesQuery = useQuery({
    queryFn: () => fetchPlaceVisits(start, end),
    queryKey: ['placeVisits', selectedDate.value],
    staleTime: 5 * 60 * 1000,
  })

  const detectedQuery = useQuery({
    queryFn: fetchStoredDetectedLocations,
    queryKey: ['storedDetectedLocations'],
    staleTime: 5 * 60 * 1000,
  })

  const namedQuery = useQuery({
    queryFn: fetchNamedLocations,
    queryKey: ['namedLocations'],
    staleTime: 5 * 60 * 1000,
  })

  const promoteMutation = useMutation({
    mutationFn: promoteDetectedLocation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['namedLocations'] })
      queryClient.invalidateQueries({ queryKey: ['placeVisits'] })
      queryClient.invalidateQueries({ queryKey: ['storedDetectedLocations'] })
      setNamingLocation(null)
      setNameInput('')
    },
  })

  const addNamedMutation = useMutation({
    mutationFn: addNamedLocation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['namedLocations'] })
      queryClient.invalidateQueries({ queryKey: ['placeVisits'] })
      setNamingLocation(null)
      setNameInput('')
    },
  })

  // Auto-select place from URL param after data loads
  useEffect(() => {
    if (!initialNameRef.current || !placesQuery.data) return
    const match = placesQuery.data.find((p) => p.name === initialNameRef.current)
    if (match) {
      setSelectedPlace(match)
      initialNameRef.current = null
    }
  }, [placesQuery.data])

  // Initialize Leaflet map
  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current) return

    const map = L.map(mapRef.current, {
      center: [59.33, 18.07], // Default to Stockholm
      zoom: 13,
      zoomControl: true,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map)

    leafletMapRef.current = map

    // Cleanup on unmount
    return () => {
      map.remove()
      leafletMapRef.current = null
    }
  }, [])

  // Update map when selected place changes
  useEffect(() => {
    const map = leafletMapRef.current
    if (!map) return

    if (selectedPlace && 'lat' in selectedPlace && selectedPlace.lat && selectedPlace.lon) {
      const latLng: L.LatLngExpression = [selectedPlace.lat, selectedPlace.lon]

      // Remove existing marker
      if (markerRef.current) {
        markerRef.current.remove()
      }

      // Add new marker
      const marker = L.marker(latLng).addTo(map)
      const popupContent = 'name' in selectedPlace ? selectedPlace.name : 'Selected Location'
      marker.bindPopup(popupContent).openPopup()
      markerRef.current = marker

      // Center map on the marker
      map.setView(latLng, 15)
    }
  }, [selectedPlace])

  // Resize map when container size changes
  useEffect(() => {
    const map = leafletMapRef.current
    if (!map) return

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize()
    })

    if (mapRef.current) {
      resizeObserver.observe(mapRef.current)
    }

    return () => resizeObserver.disconnect()
  }, [])

  const handleDateChange = (e: Event) => {
    const target = e.target as HTMLInputElement
    selectedDate.value = target.value
  }

  const handlePreviousDay = () => {
    selectedDate.value = formatISO(subDays(new Date(selectedDate.value), 1), { representation: 'date' })
  }

  const handleNextDay = () => {
    const next = new Date(selectedDate.value)
    next.setDate(next.getDate() + 1)
    selectedDate.value = formatISO(next, { representation: 'date' })
  }

  const handlePlaceClick = (place: PlaceVisit) => {
    setSelectedPlace(place)
    // Open naming modal for unnamed locations (detected or unknown) with valid coordinates
    if ((place.source === 'detected' || place.source === 'unknown') && place.lat && place.lon) {
      setNamingLocation({ address: place.address, lat: place.lat, lon: place.lon })
      setNameInput(place.address || '')
    }
  }

  const handlePromote = () => {
    if (!namingLocation || !nameInput.trim()) return

    // Use appropriate mutation based on whether it's a detected location
    const placeSource = selectedPlace && 'source' in selectedPlace ? selectedPlace.source : null
    if (placeSource === 'detected') {
      promoteMutation.mutate({
        lat: namingLocation.lat,
        lon: namingLocation.lon,
        name: nameInput.trim(),
      })
    } else {
      // For unknown locations, create a new named location directly
      addNamedMutation.mutate({
        lat: namingLocation.lat,
        lon: namingLocation.lon,
        name: nameInput.trim(),
      })
    }
  }

  const closeModal = () => {
    setNamingLocation(null)
    setNameInput('')
  }

  // Handle escape key to close modal
  useEffect(() => {
    if (!namingLocation) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeModal()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [namingLocation])

  const isLoading = placesQuery.isLoading || detectedQuery.isLoading || namedQuery.isLoading
  const hasError = placesQuery.isError || detectedQuery.isError || namedQuery.isError
  const places = placesQuery.data || []

  // Calculate transit periods between stays
  const placesWithTransit = places.reduce<
    (PlaceVisit | { type: 'transit'; start_time: Date; end_time: Date })[]
  >((acc, place, index) => {
    if (index > 0) {
      const prevPlace = places[index - 1]
      const transitStart = prevPlace.end_time
      const transitEnd = place.start_time
      const transitDuration = (transitEnd.getTime() - transitStart.getTime()) / (1000 * 60)

      // Only show transit if there's a gap of more than 1 minute
      if (transitDuration > 1) {
        acc.push({ end_time: transitEnd, start_time: transitStart, type: 'transit' })
      }
    }
    acc.push(place)
    return acc
  }, [])

  const getSourceColor = (source: string): string => {
    switch (source) {
      case 'named':
        return '#22c55e'
      case 'detected':
        return '#f97316'
      case 'owntracks':
        return '#3b82f6'
      default:
        return '#9ca3af'
    }
  }

  const isPending = promoteMutation.isPending || addNamedMutation.isPending

  return (
    <div class="places-page">
      <div class="places-header">
        <h1>Places</h1>
        <div class="date-nav">
          <button onClick={handlePreviousDay}>&lt;</button>
          <input type="date" value={selectedDate.value} onChange={handleDateChange} />
          <button onClick={handleNextDay}>&gt;</button>
        </div>
      </div>

      {isLoading && <div class="loading">Loading...</div>}
      {hasError && <div class="error">Error loading data</div>}

      <div class="places-content">
        <div class="places-list">
          <div class="places-list-scroll">
            {placesWithTransit.length === 0 && !isLoading && (
              <div style={{ color: '#6b7280', padding: '1rem' }}>No places visited on this day</div>
            )}

            {placesWithTransit.map((item, index) => {
              if ('type' in item && item.type === 'transit') {
                return (
                  <div key={`transit-${index}`} class="transit-item">
                    {format(item.start_time, 'HH:mm')} - {format(item.end_time, 'HH:mm')} Transit
                  </div>
                )
              }

              const place = item as PlaceVisit
              const isSelected = selectedPlace === place
              const isUnnamed = place.source === 'detected' || place.source === 'unknown'

              return (
                <div
                  key={`place-${index}`}
                  class={`place-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => handlePlaceClick(place)}
                  style={{ borderLeft: `3px solid ${getSourceColor(place.source)}` }}
                >
                  <div class="place-item-header">
                    <span class="place-time">
                      {format(place.start_time, 'HH:mm')} - {format(place.end_time, 'HH:mm')}
                    </span>
                    <span class={`place-name ${isUnnamed ? 'unnamed' : ''}`}>
                      {place.name}
                      {isUnnamed && place.lat && place.lon && ' (click to name)'}
                    </span>
                  </div>
                  {place.address && place.source !== 'named' && (
                    <div class="place-address">{place.address}</div>
                  )}
                  <div class="place-duration">{place.duration} min</div>
                </div>
              )
            })}
          </div>

          <div class="places-list-footer">
            <span style={{ color: '#22c55e' }}>Named</span> |{' '}
            <span style={{ color: '#f97316' }}>Detected</span> |{' '}
            <span style={{ color: '#3b82f6' }}>OwnTracks</span> |{' '}
            <span style={{ color: '#9ca3af' }}>Unknown</span>
          </div>
        </div>

        <div class="map-container">
          <div ref={mapRef} style={{ height: '100%', width: '100%' }} />
        </div>
      </div>

      {/* Naming Modal */}
      {namingLocation && (
        <div class="modal-overlay" onClick={closeModal}>
          <div class="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Name this location</h3>

            {namingLocation.address && <div class="modal-address">Address: {namingLocation.address}</div>}

            <div class="modal-field">
              <label>Location name:</label>
              <input
                type="text"
                value={nameInput}
                onInput={(e) => setNameInput((e.target as HTMLInputElement).value)}
                placeholder="e.g., Home, Office, Gym"
                autofocus
              />
            </div>

            <div class="modal-actions">
              <button onClick={closeModal}>Cancel</button>
              <button class="btn-primary" onClick={handlePromote} disabled={!nameInput.trim() || isPending}>
                {isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
