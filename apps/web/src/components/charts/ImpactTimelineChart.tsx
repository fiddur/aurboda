import type { ImpactBucket } from '@aurboda/api-spec'

import { impactBucketLabel } from '@aurboda/api-spec'
import * as d3 from 'd3'
import { useEffect, useRef } from 'preact/hooks'

import type { BaselineData } from '../../state/api'

import './ImpactFigure.css'

type ChartGroup = d3.Selection<SVGGElement, unknown, null, undefined>

const paddedDomain = (values: (number | null)[]): [number, number] => {
  const present = values.filter((d): d is number => d !== null)
  if (present.length === 0) return [0, 100]
  const [lo, hi] = d3.extent(present) as [number, number]
  const padding = (hi - lo) * 0.3 || 10
  return [lo - padding, hi + padding]
}

const drawHrvAxis = (g: ChartGroup, y: d3.ScaleLinear<number, number>) => {
  g.append('g').call(d3.axisLeft(y).ticks(4)).selectAll('text').attr('fill', '#10b981')

  g.append('text')
    .attr('x', 10)
    .attr('y', -10)
    .attr('fill', '#10b981')
    .attr('font-size', '12px')
    .text('HRV (ms)')
}

const drawHrAxis = (g: ChartGroup, y: d3.ScaleLinear<number, number>, innerWidth: number) => {
  g.append('g')
    .attr('transform', `translate(${innerWidth},0)`)
    .call(d3.axisRight(y).ticks(4))
    .selectAll('text')
    .attr('fill', '#ef4444')

  g.append('text')
    .attr('x', innerWidth - 10)
    .attr('y', -10)
    .attr('text-anchor', 'end')
    .attr('fill', '#ef4444')
    .attr('font-size', '12px')
    .text('HR (bpm)')
}

const drawSeries = (
  g: ChartGroup,
  values: (number | null)[],
  x: d3.ScalePoint<number>,
  y: d3.ScaleLinear<number, number>,
  color: string,
) => {
  const line = d3
    .line<number | null>()
    .defined((d) => d !== null)
    .x((_, i) => x(i)!)
    .y((d) => y(d!))
    .curve(d3.curveMonotoneX)

  g.append('path')
    .datum(values)
    .attr('fill', 'none')
    .attr('stroke', color)
    .attr('stroke-width', 2)
    .attr('d', line)

  values.forEach((d, i) => {
    if (d !== null) {
      g.append('circle')
        .attr('cx', x(i)!)
        .attr('cy', y(d))
        .attr('r', 5)
        .attr('fill', color)
        .attr('stroke', 'white')
        .attr('stroke-width', 2)
    }
  })
}

/** HRV, heart rate and stress per bucket around the sessions, each on its own scale; the HRV baseline when given. */
export function ImpactTimelineChart({
  timeline,
  baseline,
}: {
  timeline: ImpactBucket[]
  baseline?: BaselineData | null
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return

    const containerWidth = containerRef.current.clientWidth
    const height = 200
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const margin = { bottom: 40, left: 50, right: 50, top: 30 }
    const width = containerWidth
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    const labels = timeline.map(impactBucketLabel)
    const duringIndex = timeline.findIndex((b) => b.phase === 'during')

    const hrvData = timeline.map((b) => b.hrv.mean)
    const hrData = timeline.map((b) => b.hr.mean)
    const stressData = timeline.map((b) => b.stress.mean)

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`)

    const x = d3
      .scalePoint<number>()
      .domain(timeline.map((_, i) => i))
      .range([0, innerWidth])

    const hasHrv = hrvData.some((d) => d !== null)
    const hasHr = hrData.some((d) => d !== null)
    const hasStress = stressData.some((d) => d !== null)

    const yHrv = d3.scaleLinear().domain(paddedDomain(hrvData)).range([innerHeight, 0])
    const yHr = d3.scaleLinear().domain(paddedDomain(hrData)).range([innerHeight, 0])
    const yStress = d3.scaleLinear().domain(paddedDomain(stressData)).range([innerHeight, 0])

    const hrvBaseline = baseline?.hrv.avg30day
    if (hasHrv && hrvBaseline != null) {
      g.append('line')
        .attr('x1', 0)
        .attr('y1', yHrv(hrvBaseline))
        .attr('x2', innerWidth)
        .attr('y2', yHrv(hrvBaseline))
        .attr('stroke', '#10b981')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4,4')
        .attr('opacity', 0.5)
    }

    drawSeries(g, hrvData, x, yHrv, '#10b981')
    drawSeries(g, hrData, x, yHr, '#ef4444')
    if (hasStress) drawSeries(g, stressData, x, yStress, '#f59e0b')

    if (duringIndex >= 0) {
      const zoneWidth = Math.min(60, x.step())
      g.append('rect')
        .attr('x', x(duringIndex)! - zoneWidth / 2)
        .attr('y', 0)
        .attr('width', zoneWidth)
        .attr('height', innerHeight)
        .attr('fill', '#3b82f6')
        .attr('fill-opacity', 0.1)
    }

    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).tickFormat((_, i) => labels[i]))
      .selectAll('text')
      .attr('fill', 'currentColor')

    if (hasHrv) drawHrvAxis(g, yHrv)
    if (hasHr) drawHrAxis(g, yHr, innerWidth)
  }, [timeline, baseline])

  return (
    <div ref={containerRef} class="impact-chart-container">
      <svg ref={svgRef} />
    </div>
  )
}
