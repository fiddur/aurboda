import type { ActivityImpactData, ImpactGroup } from '@aurboda/api-spec'

import { impactBucketLabel } from '@aurboda/api-spec'
import * as d3 from 'd3'
import { useEffect, useRef } from 'preact/hooks'

import { SERIES_COLORS } from '../../components/charts/breakdown'
import { drawSeries, paddedDomain } from '../../components/charts/ImpactTimelineChart'
import '../../components/charts/ImpactFigure.css'
import { metricAccessors } from './slicing'

const OVERALL_COLOR = 'var(--color-text, currentColor)'

/** One metric around the sessions: every session as a thick line in the text colour, then one line per group. */
export function GroupImpactChart({
  overall,
  groups,
  metricKey,
  metricLabel,
  unit,
}: {
  overall: ActivityImpactData
  groups: ImpactGroup[]
  metricKey: string
  metricLabel: string
  unit?: string | null
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const { series } = metricAccessors(metricKey)
  const timeline = overall.timeline
  const overallValues = series(overall)
  const groupValues = groups.map(series)
  // The effect depends on the series through this key: they are rebuilt on every render.
  const seriesKey = JSON.stringify([overallValues, groups.map((g) => g.key), groupValues])

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return

    const width = containerRef.current.clientWidth
    const height = 200
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const margin = { bottom: 40, left: 50, right: 50, top: 30 }
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    const labels = timeline.map(impactBucketLabel)
    const duringIndex = timeline.findIndex((b) => b.phase === 'during')

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`)

    const x = d3
      .scalePoint<number>()
      .domain(timeline.map((_, i) => i))
      .range([0, innerWidth])

    const y = d3
      .scaleLinear()
      .domain(paddedDomain([...overallValues, ...groupValues.flat()]))
      .range([innerHeight, 0])

    if (duringIndex >= 0) {
      const zoneWidth = Math.min(60, x.step())
      g.append('rect')
        .attr('x', (x(duringIndex) ?? 0) - zoneWidth / 2)
        .attr('y', 0)
        .attr('width', zoneWidth)
        .attr('height', innerHeight)
        .attr('fill', '#3b82f6')
        .attr('fill-opacity', 0.1)
    }

    drawSeries(g, overallValues, x, y, 'currentColor', 3)
    groupValues.forEach((values, i) => drawSeries(g, values, x, y, SERIES_COLORS[i % SERIES_COLORS.length]))

    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).tickFormat((_, i) => labels[i]))
      .selectAll('text')
      .attr('fill', 'currentColor')

    g.append('g').call(d3.axisLeft(y).ticks(4)).selectAll('text').attr('fill', 'currentColor')

    g.append('text')
      .attr('x', 10)
      .attr('y', -10)
      .attr('fill', 'currentColor')
      .attr('font-size', '12px')
      .text(unit ? `${metricLabel} (${unit})` : metricLabel)
  }, [timeline, seriesKey, metricLabel, unit])

  if (groups.length === 0) return null

  return (
    <>
      <div ref={containerRef} class="impact-chart-container">
        <svg ref={svgRef} />
      </div>
      <div class="impact-legend">
        <span>
          <span class="impact-dot" style={{ background: OVERALL_COLOR }} /> All sessions (
          {overall.occurrences})
        </span>
        {groups.map((group, i) => (
          <span key={group.key}>
            <span class="impact-dot" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />{' '}
            {group.label} ({group.occurrences})
          </span>
        ))}
        <span>
          <span class="impact-zone" /> Activity period
        </span>
      </div>
    </>
  )
}
