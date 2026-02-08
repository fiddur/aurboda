/**
 * TrendChartWidget - Displays EMA trend visualization.
 */

import type { TrendChartConfig } from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'
import * as d3 from 'd3'
import { useEffect, useRef } from 'preact/hooks'
import { fetchTrend, type TrendResult } from '../../state/api'

interface TrendChartWidgetProps {
  config: TrendChartConfig
}

// Parsed data point for the chart
interface ParsedDataPoint {
  date: Date
  value: number
}

// Trend chart component using D3
function TrendChart({
  data,
  width = 300,
  height = 150,
  displayPeriod,
}: {
  data: TrendResult
  width?: number
  height?: number
  displayPeriod: string
}) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svgRef.current || data.history.length < 2) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const margin = { bottom: 30, left: 50, right: 20, top: 20 }
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    // Parse dates and values from history
    const parsedData: ParsedDataPoint[] = data.history.map((d) => ({
      date: new Date(d.date),
      value: d.value,
    }))

    const x = d3
      .scaleTime()
      .domain(d3.extent(parsedData, (d) => d.date) as [Date, Date])
      .range([0, innerWidth])

    const maxValue = d3.max(parsedData, (d) => d.value) ?? 0
    const y = d3
      .scaleLinear()
      .domain([0, maxValue * 1.1])
      .range([innerHeight, 0])

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    // Add axes
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).ticks(5))
      .selectAll('text')
      .attr('fill', '#9ca3af')
      .style('font-size', '10px')

    g.append('g')
      .call(d3.axisLeft(y).ticks(5))
      .selectAll('text')
      .attr('fill', '#9ca3af')
      .style('font-size', '10px')

    // Draw area under the line
    const area = d3
      .area<ParsedDataPoint>()
      .x((d) => x(d.date))
      .y0(innerHeight)
      .y1((d) => y(d.value))
      .curve(d3.curveMonotoneX)

    g.append('path').datum(parsedData).attr('fill', '#e5e7eb').attr('d', area)

    // Draw trend line
    const line = d3
      .line<ParsedDataPoint>()
      .x((d) => x(d.date))
      .y((d) => y(d.value))
      .curve(d3.curveMonotoneX)

    g.append('path')
      .datum(parsedData)
      .attr('fill', 'none')
      .attr('stroke', '#673ab8')
      .attr('stroke-width', 2)
      .attr('d', line)

    // Add current value label
    g.append('text')
      .attr('x', innerWidth)
      .attr('y', 0)
      .attr('text-anchor', 'end')
      .attr('fill', '#673ab8')
      .style('font-size', '12px')
      .style('font-weight', '600')
      .text(`${data.currentValue.toFixed(1)} / ${displayPeriod}`)
  }, [data, width, height, displayPeriod])

  return <svg ref={svgRef} width={width} height={height} />
}

export function TrendChartWidget({ config }: TrendChartWidgetProps) {
  const {
    sourceType,
    pattern,
    title,
    halfLifeDays = 15,
    lookbackDays = 90,
    displayPeriod = 'monthly',
    aggregation = 'count',
  } = config

  const trendQuery = useQuery({
    queryFn: () =>
      fetchTrend({
        aggregation,
        displayPeriod,
        halfLifeDays,
        lookbackDays,
        pattern,
        sourceType,
      }),
    queryKey: ['trend', sourceType, pattern, halfLifeDays, lookbackDays, displayPeriod, aggregation],
    staleTime: 5 * 60 * 1000,
  })

  const displayTitle = title ?? `${pattern} trend`

  if (trendQuery.isLoading) {
    return (
      <div class="trend-chart-widget">
        <h4>{displayTitle}</h4>
        <div class="chart-loading">Loading trend data...</div>
      </div>
    )
  }

  if (trendQuery.isError || !trendQuery.data) {
    return (
      <div class="trend-chart-widget">
        <h4>{displayTitle}</h4>
        <div class="chart-error">Unable to load trend data</div>
      </div>
    )
  }

  return (
    <div class="trend-chart-widget">
      <h4>{displayTitle}</h4>
      <TrendChart data={trendQuery.data} displayPeriod={displayPeriod} />
    </div>
  )
}
