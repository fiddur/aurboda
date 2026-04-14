import type { RefObject } from 'preact'

import * as d3 from 'd3'
import { useCallback, useEffect, useRef } from 'preact/hooks'

import type { Orientation } from './types'

import { computeHorizontalZoomTransform, computeVerticalZoomTransform } from './zoomTransform'

export const HORIZONTAL_MARGIN = { bottom: 30, left: 60, right: 60, top: 10 }
export const VERTICAL_MARGIN = { bottom: 10, left: 60, right: 10, top: 30 }

export interface UseTimelineZoomConfig {
  svgRef: RefObject<SVGSVGElement>
  containerRef: RefObject<HTMLDivElement>
  orientation: Orientation
  drawRef: RefObject<((scale: d3.ScaleTime<number, number>) => void) | null>
  onZoomEnd: (start: Date, end: Date) => void
  onResetToToday: () => void
}

export interface UseTimelineZoomResult {
  baseScaleRef: RefObject<d3.ScaleTime<number, number>>
  /** The last scale passed to draw(). Use this to redraw on data change without resetting view position. */
  currentScaleRef: RefObject<d3.ScaleTime<number, number> | null>
  /**
   * Call after building/rebuilding the SVG scaffold.
   * Creates zoom behavior (if needed), attaches it to the SVG, and syncs the transform
   * so the visible region matches [viewStart, viewEnd].
   */
  attachZoom: (
    baseScale: d3.ScaleTime<number, number>,
    viewStart: Date,
    viewEnd: Date,
    chartDimension: number,
  ) => void
}

export const useTimelineZoom = ({
  svgRef,
  containerRef,
  orientation,
  drawRef,
  onZoomEnd,
  onResetToToday,
}: UseTimelineZoomConfig): UseTimelineZoomResult => {
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown>>()
  const isProgrammaticZoom = useRef(false)
  const zoomRafRef = useRef<number>(0)
  const baseScaleRef = useRef<d3.ScaleTime<number, number>>(null!)
  const currentScaleRef = useRef<d3.ScaleTime<number, number> | null>(null)
  const orientationRef = useRef(orientation)
  orientationRef.current = orientation

  // Store callbacks in refs so zoom closures always see the latest version
  const onZoomEndRef = useRef(onZoomEnd)
  onZoomEndRef.current = onZoomEnd
  const onResetRef = useRef(onResetToToday)
  onResetRef.current = onResetToToday

  // Clean up rAF on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(zoomRafRef.current)
    }
  }, [])

  // Create the zoom behavior for the current orientation.
  // Called lazily from attachZoom — not in a useEffect — so the SVG and baseScale are guaranteed ready.
  const createZoomBehavior = useCallback(() => {
    if (!svgRef.current) return
    const svg = d3.select(svgRef.current)

    if (orientationRef.current === 'vertical') {
      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 20])
        .clickDistance(5)
        .filter((event: Event) => event.type !== 'dblclick')
        .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
          if (isProgrammaticZoom.current) return
          const baseScale = baseScaleRef.current
          if (!baseScale) return
          const newY = event.transform.rescaleY(baseScale)
          const newDomain = newY.domain() as [Date, Date]
          const h = containerRef.current
            ? Math.max(200, containerRef.current.clientHeight - VERTICAL_MARGIN.top - VERTICAL_MARGIN.bottom)
            : 800
          const scale = d3.scaleTime().domain(newDomain).range([0, h])
          currentScaleRef.current = scale
          cancelAnimationFrame(zoomRafRef.current)
          zoomRafRef.current = requestAnimationFrame(() => {
            drawRef.current?.(scale)
          })
        })
        .on('end', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
          if (isProgrammaticZoom.current) return
          const baseScale = baseScaleRef.current
          if (!baseScale) return
          const newY = event.transform.rescaleY(baseScale)
          const newDomain = newY.domain() as [Date, Date]
          onZoomEndRef.current(newDomain[0], newDomain[1])
        })

      svg.call(zoom)
      zoomBehaviorRef.current = zoom
    } else {
      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 50])
        .clickDistance(5)
        .filter((event: Event) => event.type !== 'dblclick')
        .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
          if (isProgrammaticZoom.current) return
          const baseScale = baseScaleRef.current
          if (!baseScale) return
          const newX = event.transform.rescaleX(baseScale)
          const newDomain = newX.domain() as [Date, Date]
          // Read current width inside handler to stay correct after resize
          const w = containerRef.current
            ? containerRef.current.clientWidth - HORIZONTAL_MARGIN.left - HORIZONTAL_MARGIN.right
            : 800
          const scale = d3.scaleTime().domain(newDomain).range([0, w])
          currentScaleRef.current = scale
          cancelAnimationFrame(zoomRafRef.current)
          zoomRafRef.current = requestAnimationFrame(() => {
            drawRef.current?.(scale)
          })
        })
        .on('end', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
          if (isProgrammaticZoom.current) return
          const baseScale = baseScaleRef.current
          if (!baseScale) return
          const newX = event.transform.rescaleX(baseScale)
          const newDomain = newX.domain() as [Date, Date]
          onZoomEndRef.current(newDomain[0], newDomain[1])
        })

      svg.call(zoom)
      zoomBehaviorRef.current = zoom
    }

    svg.on('dblclick.zoom', () => onResetRef.current())
  }, [svgRef, containerRef, drawRef])

  // ── attachZoom — called by render functions after scaffold setup ──────────

  const attachZoom = useCallback(
    (baseScale: d3.ScaleTime<number, number>, viewStart: Date, viewEnd: Date, chartDimension: number) => {
      baseScaleRef.current = baseScale

      if (!svgRef.current) return

      // (Re-)create zoom behavior if needed (first call, or orientation changed)
      if (!zoomBehaviorRef.current) {
        createZoomBehavior()
      }

      const svg = d3.select(svgRef.current)
      const zoom = zoomBehaviorRef.current
      if (!zoom) return

      // Re-attach zoom to SVG (needed after scaffold rebuild clears event listeners)
      svg.call(zoom)

      const t =
        orientationRef.current === 'vertical'
          ? computeVerticalZoomTransform(baseScale, viewStart, viewEnd, chartDimension)
          : computeHorizontalZoomTransform(baseScale, viewStart, viewEnd, chartDimension)

      isProgrammaticZoom.current = true
      svg.call(zoom.transform, t)
      isProgrammaticZoom.current = false

      // Also set currentScaleRef so data-change redraws use the right scale
      const range: [number, number] = [0, chartDimension]
      currentScaleRef.current = d3.scaleTime().domain([viewStart, viewEnd]).range(range)
    },
    [svgRef, createZoomBehavior],
  )

  // Reset zoom behavior when orientation changes (the behavior needs to use rescaleX vs rescaleY)
  useEffect(() => {
    zoomBehaviorRef.current = undefined
  }, [orientation])

  return { baseScaleRef, currentScaleRef, attachZoom }
}
