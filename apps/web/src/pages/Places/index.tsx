import { signal } from '@preact/signals'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { endOfDay, format, formatISO, startOfDay, subDays } from 'date-fns'
import { useEffect, useState } from 'preact/hooks'
import {
  fetchNamedLocations,
  fetchPlaceVisits,
  fetchStoredDetectedLocations,
  PlaceVisit,
  promoteDetectedLocation,
  StoredDetectedLocation,
} from '../../state/api'

// Signals for date selection
const selectedDate = signal(formatISO(new Date(), { representation: 'date' }))

export const Places = () => {
  const queryClient = useQueryClient()
  const start = startOfDay(new Date(selectedDate.value))
  const end = endOfDay(new Date(selectedDate.value))

  // Selected place for the map
  const [selectedPlace, setSelectedPlace] = useState<PlaceVisit | StoredDetectedLocation | null>(null)

  // Modal state for naming locations
  const [namingLocation, setNamingLocation] = useState<{
    lat: number
    lon: number
    address?: string
  } | null>(null)
  const [nameInput, setNameInput] = useState('')

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
    // If it's a detected/unnamed location, offer to name it
    if (place.source === 'detected' && place.lat && place.lon) {
      setNamingLocation({ address: place.address, lat: place.lat, lon: place.lon })
      setNameInput(place.address || '')
    }
  }

  const handlePromote = () => {
    if (namingLocation && nameInput.trim()) {
      promoteMutation.mutate({
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
    (PlaceVisit | { type: 'transit'; startTime: Date; endTime: Date })[]
  >((acc, place, index) => {
    if (index > 0) {
      const prevPlace = places[index - 1]
      const transitStart = prevPlace.endTime
      const transitEnd = place.startTime
      const transitDuration = (transitEnd.getTime() - transitStart.getTime()) / (1000 * 60)

      // Only show transit if there's a gap of more than 1 minute
      if (transitDuration > 1) {
        acc.push({ endTime: transitEnd, startTime: transitStart, type: 'transit' })
      }
    }
    acc.push(place)
    return acc
  }, [])

  return (
    <div
      class="places-page"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '1rem' }}
    >
      <div style={{ alignItems: 'center', display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>Places</h1>
        <div style={{ alignItems: 'center', display: 'flex', gap: '0.5rem' }}>
          <button onClick={handlePreviousDay}>&lt;</button>
          <input type="date" value={selectedDate.value} onChange={handleDateChange} />
          <button onClick={handleNextDay}>&gt;</button>
        </div>
      </div>

      {isLoading && <div>Loading...</div>}
      {hasError && <div>Error loading data</div>}

      <div style={{ display: 'flex', flex: 1, gap: '1rem', minHeight: 0 }}>
        {/* Places list */}
        <div
          style={{
            border: '1px solid #ccc',
            borderRadius: '4px',
            flex: '0 0 400px',
            overflow: 'auto',
            padding: '0.5rem',
          }}
        >
          {placesWithTransit.length === 0 && !isLoading && (
            <div style={{ color: '#666' }}>No places visited on this day</div>
          )}

          {placesWithTransit.map((item, index) => {
            if ('type' in item && item.type === 'transit') {
              return (
                <div
                  key={`transit-${index}`}
                  style={{
                    borderLeft: '2px dashed #ccc',
                    color: '#999',
                    marginLeft: '0.5rem',
                    padding: '0.25rem 0.5rem',
                  }}
                >
                  {format(item.startTime, 'HH:mm')} - {format(item.endTime, 'HH:mm')} Transit
                </div>
              )
            }

            const place = item as PlaceVisit
            const isSelected = selectedPlace === place
            const isUnnamed = place.source === 'detected'

            return (
              <div
                key={`place-${index}`}
                onClick={() => handlePlaceClick(place)}
                style={{
                  backgroundColor: isSelected ? '#e3f2fd' : 'transparent',
                  borderLeft: `3px solid ${getSourceColor(place.source)}`,
                  cursor: 'pointer',
                  marginBottom: '0.25rem',
                  padding: '0.5rem',
                }}
              >
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <span style={{ color: '#666', minWidth: '100px' }}>
                    {format(place.startTime, 'HH:mm')} - {format(place.endTime, 'HH:mm')}
                  </span>
                  <span style={{ fontWeight: isUnnamed ? 'normal' : 'bold' }}>
                    {place.name}
                    {isUnnamed && ' ●'}
                  </span>
                </div>
                {place.address && place.source !== 'named' && (
                  <div style={{ color: '#666', fontSize: '0.85em', marginTop: '0.25rem' }}>
                    {place.address}
                  </div>
                )}
                <div style={{ color: '#999', fontSize: '0.8em' }}>{place.durationMinutes} min</div>
              </div>
            )
          })}

          <div
            style={{
              borderTop: '1px solid #ccc',
              color: '#666',
              fontSize: '0.85em',
              marginTop: '1rem',
              paddingTop: '0.5rem',
            }}
          >
            ● = Unnamed location (click to name)
          </div>
        </div>

        {/* Map placeholder */}
        <div
          style={{
            alignItems: 'center',
            backgroundColor: '#f5f5f5',
            border: '1px solid #ccc',
            borderRadius: '4px',
            display: 'flex',
            flex: 1,
            justifyContent: 'center',
          }}
        >
          {selectedPlace && 'lat' in selectedPlace && selectedPlace.lat && selectedPlace.lon ?
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '3rem' }}>📍</div>
              <div style={{ marginTop: '0.5rem' }}>
                {'name' in selectedPlace ? selectedPlace.name : 'Selected Location'}
              </div>
              <div style={{ color: '#666', fontSize: '0.9em' }}>
                {selectedPlace.lat.toFixed(5)}, {selectedPlace.lon.toFixed(5)}
              </div>
            </div>
          : <div style={{ color: '#999' }}>Select a place to view on map</div>}
        </div>
      </div>

      {/* Naming Modal */}
      {namingLocation && (
        <div
          style={{
            alignItems: 'center',
            backgroundColor: 'rgba(0,0,0,0.5)',
            bottom: 0,
            display: 'flex',
            justifyContent: 'center',
            left: 0,
            position: 'fixed',
            right: 0,
            top: 0,
            zIndex: 1000,
          }}
          onClick={closeModal}
        >
          <div
            style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              maxWidth: '400px',
              padding: '1.5rem',
              width: '90%',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: '1rem', marginTop: 0 }}>Name this location</h3>

            {namingLocation.address && (
              <div style={{ color: '#666', marginBottom: '1rem' }}>Address: {namingLocation.address}</div>
            )}

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.25rem' }}>Location name:</label>
              <input
                type="text"
                value={nameInput}
                onInput={(e) => setNameInput((e.target as HTMLInputElement).value)}
                placeholder="e.g., Home, Office, Gym"
                style={{ padding: '0.5rem', width: '100%' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button onClick={closeModal}>Cancel</button>
              <button
                onClick={handlePromote}
                disabled={!nameInput.trim() || promoteMutation.isPending}
                style={{
                  backgroundColor: '#1976d2',
                  border: 'none',
                  borderRadius: '4px',
                  color: 'white',
                  cursor: nameInput.trim() ? 'pointer' : 'not-allowed',
                  padding: '0.5rem 1rem',
                }}
              >
                {promoteMutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const getSourceColor = (source: string): string => {
  switch (source) {
    case 'named':
      return '#4caf50' // green
    case 'detected':
      return '#ff9800' // orange
    case 'owntracks':
      return '#2196f3' // blue
    default:
      return '#9e9e9e' // gray
  }
}
