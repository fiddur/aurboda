/**
 * D3-based activity chart with toggleable overlays.
 *
 * Supports:
 * - Sleep hypnogram (colored bands by sleep stage)
 * - Heart rate line overlay
 * - HRV line overlay
 * - Hover tooltip with crosshair
 */
import { useQuery } from '@tanstack/react-query'
import * as d3 from 'd3'
import { format } from 'date-fns'
import { useEffect, useRef, useState } from 'preact/hooks'

import { fetchHeartRate, fetchHrv, fetchStress } from '../../state/api'
import { findNearest, findStageAtTime } from './chart-utils'
import { STAGE_COLORS, STAGE_LABELS, STAGE_Y_ORDER, type SleepStage } from './sleep-utils'

interface ActivityChartProps {
  start: Date
  end: Date
  stages?: SleepStage[]
  showHrDefault?: boolean
  showHrvDefault?: boolean
  showStressDefault?: boolean
}

const CHART_HEIGHT = 260
const MARGIN = { bottom: 30, left: 50, right: 155, top: 10 }

/** Hypnogram Y-axis labels in display order (top to bottom). */
const HYPNOGRAM_LABELS = ['Awake', 'REM', 'Light', 'Deep']
const HYPNOGRAM_Y_VALUES = [0, 1, 2, 3]

type GSelection = d3.Selection<SVGGElement, unknown, null, undefined>

const drawHypnogram = (
  g: GSelection,
  xScale: d3.ScaleTime<number, number>,
  innerWidth: number,
  innerHeight: number,
  stages: SleepStage[],
) => {
  const yScale = d3.scaleLinear().domain([-0.5, 3.5]).range([0, innerHeight])

  const yAxis = g.append('g')
  for (let i = 0; i < HYPNOGRAM_LABELS.length; i++) {
    yAxis
      .append('text')
      .attr('x', -8)
      .attr('y', yScale(HYPNOGRAM_Y_VALUES[i]!))
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .attr('fill', 'currentColor')
      .attr('font-size', '0.7rem')
      .attr('opacity', 0.6)
      .text(HYPNOGRAM_LABELS[i]!)
  }

  for (const yVal of HYPNOGRAM_Y_VALUES) {
    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', yScale(yVal))
      .attr('y2', yScale(yVal))
      .attr('stroke', 'currentColor')
      .attr('stroke-opacity', 0.1)
  }

  const bandHeight = innerHeight / 4
  for (const stage of stages) {
    const sx = xScale(new Date(stage.startTime))
    const ex = xScale(new Date(stage.endTime))
    const yVal = STAGE_Y_ORDER[stage.stage] ?? 0

    g.append('rect')
      .attr('x', sx)
      .attr('y', yScale(yVal) - bandHeight / 2)
      .attr('width', Math.max(ex - sx, 1))
      .attr('height', bandHeight)
      .attr('fill', STAGE_COLORS[stage.stage] ?? '#9ca3af')
      .attr('opacity', 0.7)
      .append('title')
      .text(
        `${STAGE_LABELS[stage.stage] ?? 'Unknown'}: ${format(new Date(stage.startTime), 'HH:mm')} – ${format(new Date(stage.endTime), 'HH:mm')}`,
      )
  }
}

const drawLineOverlay = (
  g: GSelection,
  xScale: d3.ScaleTime<number, number>,
  innerWidth: number,
  innerHeight: number,
  data: [Date, number][],
  color: string,
  unit: string,
  axisSide: 'left' | 'right',
  axisOffset: number = 0,
  forceZeroMin: boolean = false,
) => {
  const yExtent = d3.extent(data, (d) => d[1]) as [number, number]
  const padding = (yExtent[1] - yExtent[0]) * 0.1 || 5
  const yMin = forceZeroMin && yExtent[0] >= 0 ? 0 : yExtent[0] - padding
  const yScale = d3
    .scaleLinear()
    .domain([yMin, yExtent[1] + padding])
    .range([innerHeight, 0])

  if (axisSide === 'right') {
    g.append('g')
      .attr('transform', `translate(${innerWidth + axisOffset},0)`)
      .call(d3.axisRight(yScale).ticks(4))
      .selectAll('text')
      .attr('fill', color)
      .attr('font-size', '0.7rem')

    g.append('text')
      .attr('x', innerWidth + axisOffset + 35)
      .attr('y', -2)
      .attr('text-anchor', 'end')
      .attr('fill', color)
      .attr('font-size', '0.65rem')
      .text(unit)
  } else {
    g.append('g')
      .call(d3.axisLeft(yScale).ticks(4))
      .selectAll('text')
      .attr('fill', color)
      .attr('font-size', '0.7rem')
  }

  const line = d3
    .line<[Date, number]>()
    .x((d) => xScale(d[0]))
    .y((d) => yScale(d[1]))
    .curve(d3.curveMonotoneX)

  g.append('path')
    .datum(data)
    .attr('fill', 'none')
    .attr('stroke', color)
    .attr('stroke-width', 1.5)
    .attr('stroke-opacity', 0.8)
    .attr('d', line)
}

const hasData = (data: [Date, number][] | undefined): data is [Date, number][] =>
  data !== undefined && data.length > 0

/** Draw all metric overlays (HR, HRV, stress) with dynamic axis offsets. */
const drawOverlays = (
  g: GSelection,
  xScale: d3.ScaleTime<number, number>,
  innerWidth: number,
  innerHeight: number,
  hasHypnogram: boolean,
  hrData: [Date, number][] | undefined,
  hrvData: [Date, number][] | undefined,
  stressData: [Date, number][] | undefined,
) => {
  let rightAxisCount = 0

  if (hasData(hrData)) {
    const axisSide = hasHypnogram ? 'right' : 'left'
    drawLineOverlay(g, xScale, innerWidth, innerHeight, hrData, '#ef4444', 'bpm', axisSide)
    if (axisSide === 'right') rightAxisCount++
  }

  if (hasData(hrvData)) {
    const axisSide = hasData(hrData) || hasHypnogram ? 'right' : 'left'
    const offset = axisSide === 'right' ? rightAxisCount * 45 : 0
    drawLineOverlay(g, xScale, innerWidth, innerHeight, hrvData, '#14b8a6', 'ms', axisSide, offset, true)
    if (axisSide === 'right') rightAxisCount++
  }

  if (hasData(stressData)) {
    const axisSide = rightAxisCount > 0 || hasHypnogram ? 'right' : 'left'
    const offset = axisSide === 'right' ? rightAxisCount * 45 : 0
    drawLineOverlay(g, xScale, innerWidth, innerHeight, stressData, '#f97316', 'score', axisSide, offset, true)
  }
}

export const ActivityChart = ({
  start,
  end,
  stages,
  showHrDefault = false,
  showHrvDefault = false,
  showStressDefault = true,
}: ActivityChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [showHr, setShowHr] = useState(showHrDefault)
  const [showHrv, setShowHrv] = useState(showHrvDefault)
  const [showStress, setShowStress] = useState(showStressDefault)

  const hrQuery = useQuery({
    enabled: showHr,
    queryFn: () => fetchHeartRate(start, end),
    queryKey: ['detail-hr', start.toISOString(), end.toISOString()],
    staleTime: 5 * 60 * 1000,
  })

  const hrvQuery = useQuery({
    enabled: showHrv,
    queryFn: () => fetchHrv(start, end),
    queryKey: ['detail-hrv', start.toISOString(), end.toISOString()],
    staleTime: 5 * 60 * 1000,
  })

  const stressQuery = useQuery({
    enabled: showStress,
    queryFn: () => fetchStress(start, end),
    queryKey: ['detail-stress', start.toISOString(), end.toISOString()],
    staleTime: 5 * 60 * 1000,
  })

  const hasHypnogram = stages && stages.length > 0
  const hrData = showHr ? hrQuery.data : undefined
  const hrvData = showHrv ? hrvQuery.data : undefined
  const stressData = showStress ? stressQuery.data : undefined

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return

    const containerWidth = containerRef.current.clientWidth
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const innerWidth = containerWidth - MARGIN.left - MARGIN.right
    const innerHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom

    svg.attr('width', containerWidth).attr('height', CHART_HEIGHT)

    const g = svg.append('g').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`)

    const xScale = d3.scaleTime().domain([start, end]).range([0, innerWidth])

    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(xScale)
          .ticks(6)
          .tickFormat((d) => format(d as Date, 'HH:mm')),
      )
      .selectAll('text')
      .attr('fill', 'currentColor')

    if (hasHypnogram) {
      drawHypnogram(g, xScale, innerWidth, innerHeight, stages!)
    }

    drawOverlays(g, xScale, innerWidth, innerHeight, !!hasHypnogram, hrData, hrvData, stressData)

    // Tooltip crosshair and interaction overlay
    const crosshair = g
      .append('line')
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', 'currentColor')
      .attr('stroke-opacity', 0.4)
      .attr('stroke-dasharray', '4 3')
      .attr('pointer-events', 'none')
      .style('display', 'none')

    const tooltip = tooltipRef.current

    g.append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .attr('pointer-events', 'all')
      .on('mousemove', (event: MouseEvent) => {
        const [mx] = d3.pointer(event)
        const time = xScale.invert(mx)

        crosshair.attr('x1', mx).attr('x2', mx).style('display', null)

        const lines: string[] = [format(time, 'HH:mm:ss')]

        if (hasData(hrData)) {
          const nearest = findNearest(hrData, time)
          if (nearest) lines.push(`HR: ${Math.round(nearest[1])} bpm`)
        }
        if (hasData(hrvData)) {
          const nearest = findNearest(hrvData, time)
          if (nearest) lines.push(`HRV: ${Math.round(nearest[1])} ms`)
        }
        if (hasData(stressData)) {
          const nearest = findNearest(stressData, time)
          if (nearest) lines.push(`Stress: ${Math.round(nearest[1])}`)
        }
        if (hasHypnogram && stages) {
          const stage = findStageAtTime(stages, time)
          if (stage) lines.push(`Stage: ${stage}`)
        }

        if (tooltip) {
          tooltip.textContent = lines.join('\n')
          tooltip.style.display = 'block'

          // Position relative to container
          const containerRect = containerRef.current!.getBoundingClientRect()
          const svgRect = svgRef.current!.getBoundingClientRect()
          const tooltipX = mx + MARGIN.left + (svgRect.left - containerRect.left)
          const tooltipWidth = tooltip.offsetWidth
          const availableWidth = containerRect.width

          // Flip to left side if too close to right edge
          const left =
            tooltipX + tooltipWidth + 12 > availableWidth ? tooltipX - tooltipWidth - 12 : tooltipX + 12
          tooltip.style.left = `${left}px`
          tooltip.style.top = `${MARGIN.top + 8}px`
        }
      })
      .on('mouseleave', () => {
        crosshair.style('display', 'none')
        if (tooltip) tooltip.style.display = 'none'
      })
  }, [start, end, stages, hasHypnogram, hrData, hrvData, stressData])

  return (
    <div class="activity-chart-container">
      <div class="chart-toggles">
        <button
          class={`chart-toggle${showHr ? ' active' : ''}`}
          onClick={() => setShowHr(!showHr)}
          type="button"
        >
          <span class="chart-toggle-dot" style={{ background: '#ef4444' }} />
          HR {hrQuery.isLoading && showHr ? '...' : ''}
        </button>
        <button
          class={`chart-toggle${showHrv ? ' active' : ''}`}
          onClick={() => setShowHrv(!showHrv)}
          type="button"
        >
          <span class="chart-toggle-dot" style={{ background: '#14b8a6' }} />
          HRV {hrvQuery.isLoading && showHrv ? '...' : ''}
        </button>
        <button
          class={`chart-toggle${showStress ? ' active' : ''}`}
          onClick={() => setShowStress(!showStress)}
          type="button"
        >
          <span class="chart-toggle-dot" style={{ background: '#f97316' }} />
          Stress {stressQuery.isLoading && showStress ? '...' : ''}
        </button>
      </div>
      <div class="chart-svg-container" ref={containerRef}>
        <svg ref={svgRef} />
        <div class="chart-tooltip" ref={tooltipRef} />
      </div>
    </div>
  )
}
