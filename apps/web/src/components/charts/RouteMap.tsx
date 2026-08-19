/**
 * Interactive GPS route map — the presentational half of the activity detail
 * map, extracted (#1011) so the feed's native post cards render the *same*
 * time-synced map from a structured payload's route points.
 *
 * Shows the track as a polyline and highlights the position nearest to
 * `hoverTime` (the chart crosshair). Renders nothing below two points.
 */
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect, useRef } from 'preact/hooks'

import { interpolatePosition } from './chart-utils'
import './RouteMap.css'

const MIN_POINTS_FOR_PATH = 2
const PATH_COLOR = '#673ab8'
const PATH_WEIGHT = 3
const PATH_OPACITY = 0.8
const FIT_BOUNDS_PADDING = 20

const HIGHLIGHT_MARKER_SIZE = 14
const HIGHLIGHT_ICON = L.divIcon({
  className: 'activity-map-highlight',
  iconSize: [HIGHLIGHT_MARKER_SIZE, HIGHLIGHT_MARKER_SIZE],
  iconAnchor: [HIGHLIGHT_MARKER_SIZE / 2, HIGHLIGHT_MARKER_SIZE / 2],
})

/** One timestamped GPS point of the route (time-ordered). */
export interface RoutePoint {
  time: Date
  lat: number
  lon: number
}

interface RouteMapProps {
  points: RoutePoint[]
  hoverTime: Date | null
}

export const RouteMap = ({ points, hoverTime }: RouteMapProps) => {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const highlightMarkerRef = useRef<L.Marker | null>(null)

  // Initialize map + draw polyline when points arrive
  useEffect(() => {
    if (!mapContainerRef.current || points.length < MIN_POINTS_FOR_PATH) return

    // Clean up previous map if any
    if (mapRef.current) {
      mapRef.current.remove()
      mapRef.current = null
      highlightMarkerRef.current = null
    }

    const map = L.map(mapContainerRef.current, { zoomControl: true })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map)

    const latLngs: L.LatLngExpression[] = points.map((p) => [p.lat, p.lon])
    const polyline = L.polyline(latLngs, {
      color: PATH_COLOR,
      weight: PATH_WEIGHT,
      opacity: PATH_OPACITY,
    }).addTo(map)
    map.fitBounds(polyline.getBounds(), { padding: [FIT_BOUNDS_PADDING, FIT_BOUNDS_PADDING] })

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
    if (!map || points.length < MIN_POINTS_FOR_PATH) return

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
  if (points.length < MIN_POINTS_FOR_PATH) return null

  return <div ref={mapContainerRef} class="activity-map-container" />
}
