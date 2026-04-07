/**
 * Reusable sparkline chart using D3.
 * Renders a small area + line chart with a dot on the latest point.
 */
import * as d3 from 'd3'
import { useEffect, useRef } from 'preact/hooks'

export function SparklineChart({
  data,
  color,
  width = 120,
  height = 40,
}: {
  data: [Date, number][]
  color: string
  width?: number
  height?: number
}) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svgRef.current || data.length < 2) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const margin = { bottom: 4, left: 4, right: 4, top: 4 }
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    const x = d3
      .scaleTime()
      .domain(d3.extent(data, (d) => d[0]) as [Date, Date])
      .range([0, innerWidth])

    const yExtent = d3.extent(data, (d) => d[1]) as [number, number]
    const yPadding = (yExtent[1] - yExtent[0]) * 0.1 || 5
    const yMin = yExtent[0] >= 0 ? Math.max(0, yExtent[0] - yPadding) : yExtent[0] - yPadding
    const y = d3
      .scaleLinear()
      .domain([yMin, yExtent[1] + yPadding])
      .range([innerHeight, 0])

    const line = d3
      .line<[Date, number]>()
      .x((d) => x(d[0]))
      .y((d) => y(d[1]))
      .curve(d3.curveMonotoneX)

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    // Area fill
    const area = d3
      .area<[Date, number]>()
      .x((d) => x(d[0]))
      .y0(innerHeight)
      .y1((d) => y(d[1]))
      .curve(d3.curveMonotoneX)

    g.append('path').datum(data).attr('fill', color).attr('fill-opacity', 0.15).attr('d', area)

    // Line
    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 1.5)
      .attr('d', line)

    // Latest point dot
    const latest = data[data.length - 1]
    g.append('circle').attr('cx', x(latest[0])).attr('cy', y(latest[1])).attr('r', 3).attr('fill', color)
  }, [data, color, width, height])

  if (data.length < 2) {
    return null
  }

  return <svg ref={svgRef} width={width} height={height} />
}
