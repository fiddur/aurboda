/**
 * Shows the track as a polyline and highlights the position nearest to
 * `hoverTime` (the chart crosshair). Renders nothing below two points.
 */
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useCallback, useEffect, useRef } from 'preact/hooks'

import { interpolatePosition } from './chart-utils'
import { useInView } from './useInView'
import './RouteMap.css'

const MIN_POINTS_FOR_PATH = 2
const PATH_COLOR = '#673ab8'
const PATH_WEIGHT = 3
const PATH_OPACITY = 0.8
const FIT_BOUNDS_PADDING = 20
/** Start loading a map (Leaflet + OSM tiles) a little before it scrolls into view. */
const PRELOAD_MARGIN = { rootMargin: '200px' }

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
  // A feed of routes would otherwise mount a map and fetch tiles for every post,
  // off-screen ones included (#1016). The container keeps its size while empty.
  const { inView, ref: observeContainer } = useInView(PRELOAD_MARGIN)
  const containerRef = useCallback(
    (element: HTMLDivElement | null) => {
      mapContainerRef.current = element
      observeContainer(element)
    },
    [observeContainer],
  )

  useEffect(() => {
    if (!inView || !mapContainerRef.current || points.length < MIN_POINTS_FOR_PATH) return

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
  }, [inView, points])

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
  }, [hoverTime, inView, points])

  if (points.length < MIN_POINTS_FOR_PATH) return null

  return <div ref={containerRef} class="activity-map-container" />
}
