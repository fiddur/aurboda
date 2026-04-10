/**
 * Interactive GPS path map for activity detail.
 * Shows the GPS track as a polyline and highlights the position nearest to the chart crosshair.
 */
import 'leaflet/dist/leaflet.css'
import { useQuery } from '@tanstack/react-query'
import L from 'leaflet'
import { useEffect, useRef } from 'preact/hooks'

import { fetchRawLocations } from '../../state/api'
import { interpolatePosition } from './chart-utils'

// Fix Leaflet default marker icon path issue with bundlers
// @ts-expect-error - Leaflet marker icon fix
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const HIGHLIGHT_ICON = L.divIcon({
  className: 'activity-map-highlight',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

interface ActivityMapProps {
  start: Date
  end: Date
  hoverTime: Date | null
}

export const ActivityMap = ({ start, end, hoverTime }: ActivityMapProps) => {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const highlightMarkerRef = useRef<L.Marker | null>(null)

  const { data: points } = useQuery({
    queryFn: () => fetchRawLocations(start, end),
    queryKey: ['raw-locations', start.toISOString(), end.toISOString()],
    staleTime: 5 * 60 * 1000,
  })

  // Initialize map + draw polyline when points load
  useEffect(() => {
    if (!mapContainerRef.current || !points || points.length < 2) return

    // Clean up previous map if any
    if (mapRef.current) {
      mapRef.current.remove()
      mapRef.current = null
      highlightMarkerRef.current = null
    }

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map)

    const latLngs: L.LatLngExpression[] = points.map((p) => [p.lat, p.lon])
    const polyline = L.polyline(latLngs, { color: '#673ab8', weight: 3, opacity: 0.8 }).addTo(map)
    map.fitBounds(polyline.getBounds(), { padding: [20, 20] })

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
      highlightMarkerRef.current = null
    }
  }, [points])

  // Move highlight marker when hoverTime changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !points || points.length < 2) return

    if (!hoverTime) {
      if (highlightMarkerRef.current) {
        highlightMarkerRef.current.remove()
        highlightMarkerRef.current = null
      }
      return
    }

    const pos = interpolatePosition(points, hoverTime)
    if (!pos) return

    if (highlightMarkerRef.current) {
      highlightMarkerRef.current.setLatLng([pos.lat, pos.lon])
    } else {
      highlightMarkerRef.current = L.marker([pos.lat, pos.lon], { icon: HIGHLIGHT_ICON }).addTo(map)
    }
  }, [hoverTime, points])

  // Don't render if no GPS data
  if (!points || points.length < 2) return null

  return <div ref={mapContainerRef} class="activity-map-container" />
}
