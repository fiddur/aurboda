import type { TrainingLoadPoint } from '@aurboda/api-spec'

import * as d3 from 'd3'
import { useEffect, useRef, useState } from 'preact/hooks'

import { ATL_COLOR, CTL_COLOR, TSB_FATIGUED_COLOR, TSB_FRESH_COLOR } from '../Timeline/drawTrainingLoadTrack'

const HEIGHT = 260
const MARGIN = { bottom: 28, left: 36, right: 8, top: 10 }

interface Props {
  points: TrainingLoadPoint[]
  bootstrapping: boolean
  /** Index of the point the readout shows, or null for none. */
  onHover: (index: number | null) => void
}

export function TrainingLoadChart({ points, bootstrapping, onHover }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!svgRef.current || width === 0 || points.length === 0) return
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const innerWidth = width - MARGIN.left - MARGIN.right
    const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom
    const times = points.map((p) => new Date(p.time))

    const x = d3
      .scaleTime()
      .domain(d3.extent(times) as [Date, Date])
      .range([0, innerWidth])
    const yMin = Math.min(0, d3.min(points, (p) => p.tsb) ?? 0)
    const yMax = Math.max(1, d3.max(points, (p) => Math.max(p.ctl, p.atl, p.tsb)) ?? 1)
    const y = d3.scaleLinear().domain([yMin, yMax]).nice().range([innerHeight, 0])

    const g = svg.append('g').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`)

    g.append('g')
      .attr('class', 'tl-grid')
      .call(
        d3
          .axisLeft(y)
          .ticks(5)
          .tickSize(-innerWidth)
          .tickFormat(() => ''),
      )
    g.append('g')
      .attr('class', 'tl-axis')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(Math.max(2, Math.floor(innerWidth / 90)))
          .tickFormat((d) => d3.timeFormat('%b %d')(d as Date)),
      )
    g.append('g').attr('class', 'tl-axis').call(d3.axisLeft(y).ticks(5))

    const ctlArea = d3
      .area<TrainingLoadPoint>()
      .x((p) => x(new Date(p.time)))
      .y0(y(Math.max(0, yMin)))
      .y1((p) => y(p.ctl))
      .curve(d3.curveMonotoneX)
    g.append('path')
      .datum(points)
      .attr('fill', CTL_COLOR)
      .attr('fill-opacity', bootstrapping ? 0.08 : 0.18)
      .attr('d', ctlArea)

    const line = (value: (p: TrainingLoadPoint) => number) =>
      d3
        .line<TrainingLoadPoint>()
        .x((p) => x(new Date(p.time)))
        .y((p) => y(value(p)))
        .curve(d3.curveMonotoneX)

    g.append('path')
      .datum(points)
      .attr('fill', 'none')
      .attr('stroke', CTL_COLOR)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', bootstrapping ? '5,4' : null)
      .attr(
        'd',
        line((p) => p.ctl),
      )

    g.append('path')
      .datum(points)
      .attr('fill', 'none')
      .attr('stroke', ATL_COLOR)
      .attr('stroke-width', 1.5)
      .attr(
        'd',
        line((p) => p.atl),
      )

    const zeroOffset = innerHeight === 0 ? 0 : y(0) / innerHeight
    const gradient = svg
      .append('defs')
      .append('linearGradient')
      .attr('id', 'tl-tsb-gradient')
      .attr('gradientUnits', 'userSpaceOnUse')
      .attr('x1', 0)
      .attr('x2', 0)
      .attr('y1', 0)
      .attr('y2', innerHeight)
    gradient.append('stop').attr('offset', zeroOffset).attr('stop-color', TSB_FRESH_COLOR)
    gradient.append('stop').attr('offset', zeroOffset).attr('stop-color', TSB_FATIGUED_COLOR)

    g.append('line')
      .attr('class', 'tl-zero')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', y(0))
      .attr('y2', y(0))

    g.append('path')
      .datum(points)
      .attr('fill', 'none')
      .attr('stroke', 'url(#tl-tsb-gradient)')
      .attr('stroke-width', 2)
      .attr(
        'd',
        line((p) => p.tsb),
      )

    const cursor = g
      .append('line')
      .attr('class', 'tl-cursor')
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .style('display', 'none')

    const bisect = d3.bisector((t: Date) => t).center
    g.append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .on('pointermove', (event: PointerEvent) => {
        const [mx] = d3.pointer(event)
        const index = bisect(times, x.invert(mx))
        const cx = x(times[index])
        cursor.attr('x1', cx).attr('x2', cx).style('display', null)
        onHover(index)
      })
      .on('pointerleave', () => {
        cursor.style('display', 'none')
        onHover(null)
      })
  }, [points, bootstrapping, width, onHover])

  return (
    <div ref={containerRef} class="tl-chart">
      <svg
        ref={svgRef}
        width={width}
        height={HEIGHT}
        role="img"
        aria-label="Fitness, fatigue and form over time"
      />
    </div>
  )
}
