import { useQuery } from '@tanstack/react-query'
import * as d3 from 'd3'
import { useEffect, useRef, useState } from 'preact/hooks'
import { fetchTrend, type FetchTrendParams, type TrendDisplayPeriod, type TrendResult } from '../../state/api'
import { auth } from '../../state/auth'

import './style.css'

// Preset trend configurations for common use cases
const PRESET_TRENDS: Array<{ name: string; params: FetchTrendParams }> = [
  {
    name: 'Painkillers',
    params: {
      displayPeriod: 'monthly',
      halfLifeDays: 15,
      lookbackDays: 180,
      pattern: 'pain_killer|painkiller|ibuprofen',
      sourceType: 'tag',
    },
  },
  {
    name: 'Coffee',
    params: {
      displayPeriod: 'daily',
      halfLifeDays: 7,
      lookbackDays: 90,
      pattern: 'coffee',
      sourceType: 'tag',
    },
  },
  {
    name: 'Weight',
    params: {
      aggregation: 'mean',
      displayPeriod: 'daily',
      halfLifeDays: 14,
      lookbackDays: 180,
      pattern: 'weight',
      sourceType: 'metric',
    },
  },
]

// Chart component for trend history
function TrendChart({ data, color }: { data: { date: string; value: number }[]; color: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || data.length < 2) return

    const container = containerRef.current
    const width = container.clientWidth
    const height = 200

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', width).attr('height', height)

    const margin = { bottom: 30, left: 50, right: 20, top: 20 }
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    // Parse dates
    const parsedData = data.map((d) => ({
      date: new Date(d.date),
      value: d.value,
    }))

    const x = d3
      .scaleTime()
      .domain(d3.extent(parsedData, (d) => d.date) as [Date, Date])
      .range([0, innerWidth])

    const yExtent = d3.extent(parsedData, (d) => d.value) as [number, number]
    const yMin = Math.min(0, yExtent[0])
    const yPadding = (yExtent[1] - yMin) * 0.1 || 1
    const y = d3
      .scaleLinear()
      .domain([yMin, yExtent[1] + yPadding])
      .range([innerHeight, 0])

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    // Grid lines
    g.append('g')
      .attr('class', 'grid')
      .call(
        d3
          .axisLeft(y)
          .tickSize(-innerWidth)
          .tickFormat(() => ''),
      )
      .selectAll('line')
      .attr('stroke', '#e5e7eb')
      .attr('stroke-dasharray', '3,3')

    // Area fill
    const area = d3
      .area<{ date: Date; value: number }>()
      .x((d) => x(d.date))
      .y0(innerHeight)
      .y1((d) => y(d.value))
      .curve(d3.curveMonotoneX)

    g.append('path').datum(parsedData).attr('fill', color).attr('fill-opacity', 0.2).attr('d', area)

    // Line
    const line = d3
      .line<{ date: Date; value: number }>()
      .x((d) => x(d.date))
      .y((d) => y(d.value))
      .curve(d3.curveMonotoneX)

    g.append('path')
      .datum(parsedData)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 2)
      .attr('d', line)

    // Data points
    g.selectAll('.dot')
      .data(parsedData.filter((_, i) => i % 7 === 0 || i === parsedData.length - 1)) // Show every 7th point + last
      .join('circle')
      .attr('class', 'dot')
      .attr('cx', (d) => x(d.date))
      .attr('cy', (d) => y(d.value))
      .attr('r', 3)
      .attr('fill', color)

    // X axis
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(6)
          .tickFormat((d) => d3.timeFormat('%b %d')(d as Date)),
      )
      .selectAll('text')
      .attr('font-size', '11px')

    // Y axis
    g.append('g').call(d3.axisLeft(y).ticks(5)).selectAll('text').attr('font-size', '11px')
  }, [data, color])

  if (data.length < 2) {
    return <div class="chart-placeholder">Insufficient data for chart</div>
  }

  return (
    <div ref={containerRef} class="trend-chart-container">
      <svg ref={svgRef} />
    </div>
  )
}

// Card showing current trend value
function TrendValueCard({ result }: { result: TrendResult }) {
  const { currentValue, displayUnit, pattern, sourceType, halfLifeDays } = result

  return (
    <div class="trend-value-card">
      <div class="trend-current">
        <span class="trend-number">{currentValue.toFixed(1)}</span>
        <span class="trend-unit">{displayUnit}</span>
      </div>
      <div class="trend-meta">
        <span class="trend-pattern">{pattern}</span>
        <span class="trend-config">
          {sourceType} · {halfLifeDays}d half-life
        </span>
      </div>
    </div>
  )
}

// Form for configuring a custom trend query
function TrendConfigForm({
  onSubmit,
  isLoading,
}: {
  onSubmit: (params: FetchTrendParams) => void
  isLoading: boolean
}) {
  const [sourceType, setSourceType] = useState<'tag' | 'metric'>('tag')
  const [pattern, setPattern] = useState('')
  const [halfLifeDays, setHalfLifeDays] = useState(15)
  const [lookbackDays, setLookbackDays] = useState(90)
  const [displayPeriod, setDisplayPeriod] = useState<TrendDisplayPeriod>('monthly')
  const [aggregation, setAggregation] = useState<'count' | 'mean' | 'sum'>('count')

  const handleSubmit = (e: Event) => {
    e.preventDefault()
    if (!pattern.trim()) return

    onSubmit({
      aggregation: sourceType === 'metric' ? aggregation : 'count',
      displayPeriod,
      halfLifeDays,
      lookbackDays,
      pattern: pattern.trim(),
      sourceType,
    })
  }

  return (
    <form class="trend-config-form" onSubmit={handleSubmit}>
      <div class="form-row">
        <label>
          Source Type
          <select
            value={sourceType}
            onChange={(e) => setSourceType((e.target as HTMLSelectElement).value as 'tag' | 'metric')}
          >
            <option value="tag">Tag</option>
            <option value="metric">Metric</option>
          </select>
        </label>
        <label class="pattern-input">
          {sourceType === 'tag' ? 'Tag Pattern (regex)' : 'Metric Name'}
          <input
            type="text"
            value={pattern}
            onInput={(e) => setPattern((e.target as HTMLInputElement).value)}
            placeholder={sourceType === 'tag' ? 'e.g., coffee|caffeine' : 'e.g., weight'}
          />
        </label>
      </div>

      <div class="form-row">
        <label>
          Half-life (days)
          <select
            value={halfLifeDays}
            onChange={(e) => setHalfLifeDays(Number((e.target as HTMLSelectElement).value))}
          >
            <option value="7">7 (Quick)</option>
            <option value="15">15 (Responsive)</option>
            <option value="30">30 (Stable)</option>
          </select>
        </label>
        <label>
          Lookback (days)
          <select
            value={lookbackDays}
            onChange={(e) => setLookbackDays(Number((e.target as HTMLSelectElement).value))}
          >
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="180">180 days</option>
            <option value="365">1 year</option>
          </select>
        </label>
        <label>
          Display as
          <select
            value={displayPeriod}
            onChange={(e) => setDisplayPeriod((e.target as HTMLSelectElement).value as TrendDisplayPeriod)}
          >
            <option value="daily">Per day</option>
            <option value="weekly">Per week</option>
            <option value="monthly">Per month</option>
          </select>
        </label>
        {sourceType === 'metric' && (
          <label>
            Aggregation
            <select
              value={aggregation}
              onChange={(e) =>
                setAggregation((e.target as HTMLSelectElement).value as 'count' | 'mean' | 'sum')
              }
            >
              <option value="mean">Average</option>
              <option value="sum">Sum</option>
            </select>
          </label>
        )}
      </div>

      <button type="submit" disabled={isLoading || !pattern.trim()}>
        {isLoading ? 'Loading...' : 'Calculate Trend'}
      </button>
    </form>
  )
}

// Single trend widget that displays a preset or custom trend
function TrendWidget({ name, params }: { name: string; params: FetchTrendParams }) {
  const query = useQuery({
    queryFn: () => fetchTrend(params),
    queryKey: ['trend', params],
    staleTime: 5 * 60 * 1000,
  })

  const colors: Record<string, string> = {
    Coffee: '#78350f',
    Painkillers: '#dc2626',
    Weight: '#2563eb',
    default: '#8b5cf6',
  }
  const color = colors[name] || colors.default

  if (query.isLoading) {
    return (
      <div class="trend-widget loading">
        <h3>{name}</h3>
        <div class="loading-spinner">Loading...</div>
      </div>
    )
  }

  if (query.error || !query.data) {
    return (
      <div class="trend-widget error">
        <h3>{name}</h3>
        <div class="error-message">Failed to load trend data</div>
      </div>
    )
  }

  return (
    <div class="trend-widget">
      <h3>{name}</h3>
      <TrendValueCard result={query.data} />
      <TrendChart data={query.data.history} color={color} />
    </div>
  )
}

// Main Trends page component
export function Trends() {
  const isLoggedIn = auth.value.token
  const [customParams, setCustomParams] = useState<FetchTrendParams | null>(null)

  const customQuery = useQuery({
    enabled: !!customParams,
    queryFn: () => (customParams ? fetchTrend(customParams) : Promise.reject('No params')),
    queryKey: ['trend', 'custom', customParams],
    staleTime: 5 * 60 * 1000,
  })

  if (!isLoggedIn) {
    return (
      <div class="trends-page">
        <div class="login-prompt">
          <h2>Please log in to view trends</h2>
          <a href="/login">Log in</a>
        </div>
      </div>
    )
  }

  return (
    <div class="trends-page">
      <header class="page-header">
        <h1>Trends</h1>
        <p class="page-description">
          Time-weighted averages using Exponential Moving Average (EMA). Recent data is weighted more heavily,
          with the half-life controlling how quickly older data loses influence.
        </p>
      </header>

      <section class="preset-trends">
        <h2>Preset Trends</h2>
        <div class="trends-grid">
          {PRESET_TRENDS.map((preset) => (
            <TrendWidget key={preset.name} name={preset.name} params={preset.params} />
          ))}
        </div>
      </section>

      <section class="custom-trend">
        <h2>Custom Trend</h2>
        <TrendConfigForm onSubmit={setCustomParams} isLoading={customQuery.isLoading} />

        {customParams && customQuery.data && (
          <div class="custom-result">
            <TrendWidget name={`Custom: ${customParams.pattern}`} params={customParams} />
          </div>
        )}

        {customParams && customQuery.error && (
          <div class="custom-error">
            <p>Error loading custom trend. Check your pattern and try again.</p>
          </div>
        )}
      </section>
    </div>
  )
}
