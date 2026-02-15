/**
 * CorrelationWidget - Displays activity impact on HRV/HR.
 */

import type { CorrelationConfig } from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'
import * as d3 from 'd3'
import { useEffect, useRef } from 'preact/hooks'
import { fetchActivityImpact, type ActivityImpactData } from '../../state/api'

interface CorrelationWidgetProps {
  config: CorrelationConfig
}

// Phase data for the chart
interface PhaseData {
  phase: string
  avgHrv: number | null
}

// Impact timeline chart using D3
function ImpactChart({
  data,
  width = 300,
  height = 120,
}: {
  data: ActivityImpactData
  width?: number
  height?: number
}) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svgRef.current) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const margin = { bottom: 30, left: 40, right: 20, top: 10 }
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    // Convert timeline object to array for chart
    const timelineData: PhaseData[] = [
      { avgHrv: data.hrv_timeline.before30min.mean, phase: 'before' },
      { avgHrv: data.hrv_timeline.during.mean, phase: 'during' },
      { avgHrv: data.hrv_timeline.after30min.mean, phase: 'after' },
    ]

    const phases = timelineData.map((d) => d.phase)
    const x = d3.scaleBand().domain(phases).range([0, innerWidth]).padding(0.2)

    const hrvValues = timelineData.map((d) => d.avgHrv).filter((v): v is number => v !== null)
    if (hrvValues.length === 0) return

    const y = d3
      .scaleLinear()
      .domain([Math.min(...hrvValues) * 0.9, Math.max(...hrvValues) * 1.1])
      .range([innerHeight, 0])

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    // Add axes
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
      .attr('fill', '#9ca3af')
      .style('font-size', '10px')

    g.append('g')
      .call(d3.axisLeft(y).ticks(4))
      .selectAll('text')
      .attr('fill', '#9ca3af')
      .style('font-size', '10px')

    // Draw bars for HRV
    g.selectAll('.hrv-bar')
      .data(timelineData)
      .enter()
      .append('rect')
      .attr('class', 'hrv-bar')
      .attr('x', (d) => x(d.phase) ?? 0)
      .attr('y', (d) => (d.avgHrv !== null ? y(d.avgHrv) : innerHeight))
      .attr('width', x.bandwidth())
      .attr('height', (d) => (d.avgHrv !== null ? innerHeight - y(d.avgHrv) : 0))
      .attr('fill', (d) => {
        if (d.phase === 'before') return '#9ca3af'
        if (d.phase === 'during') return '#673ab8'
        return '#10b981'
      })
      .attr('rx', 4)

    // Add value labels
    g.selectAll('.value-label')
      .data(timelineData)
      .enter()
      .append('text')
      .attr('class', 'value-label')
      .attr('x', (d) => (x(d.phase) ?? 0) + x.bandwidth() / 2)
      .attr('y', (d) => (d.avgHrv !== null ? y(d.avgHrv) - 5 : innerHeight))
      .attr('text-anchor', 'middle')
      .attr('fill', '#374151')
      .style('font-size', '10px')
      .style('font-weight', '600')
      .text((d) => (d.avgHrv !== null ? d.avgHrv.toFixed(0) : ''))
  }, [data, width, height])

  return <svg ref={svgRef} width={width} height={height} />
}

export function CorrelationWidget({ config }: CorrelationWidgetProps) {
  const { activity, activity_type, title, period_days = 90, window_minutes = 30 } = config

  const impactQuery = useQuery({
    queryFn: () => fetchActivityImpact(activity, activity_type, period_days, window_minutes),
    queryKey: ['activityImpact', activity, activity_type, period_days, window_minutes],
    staleTime: 5 * 60 * 1000,
  })

  const displayTitle = title ?? `${activity} impact`

  if (impactQuery.isLoading) {
    return (
      <div class="correlation-widget">
        <h4>{displayTitle}</h4>
        <div class="chart-loading">Loading correlation data...</div>
      </div>
    )
  }

  if (impactQuery.isError || !impactQuery.data) {
    return (
      <div class="correlation-widget">
        <h4>{displayTitle}</h4>
        <div class="chart-error">Unable to load correlation data</div>
      </div>
    )
  }

  const { occurrences } = impactQuery.data

  return (
    <div class="correlation-widget">
      <h4>{displayTitle}</h4>
      <div class="correlation-summary">
        <span class="occurrences">{occurrences} occurrences</span>
      </div>
      <ImpactChart data={impactQuery.data} />
    </div>
  )
}
