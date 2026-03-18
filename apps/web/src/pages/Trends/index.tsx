import { useQuery } from '@tanstack/react-query'
import * as d3 from 'd3'
import { useEffect, useRef, useState } from 'preact/hooks'

import { MetricPicker } from '../../components/MetricPicker'
import { TagPicker } from '../../components/TagPicker'
import {
  fetchScreentimeCategories,
  fetchTrend,
  type FetchTrendParams,
  type TrendDisplayPeriod,
  type TrendResult,
} from '../../state/api'
import { auth } from '../../state/auth'
import {
  addSavedTrend,
  removeSavedTrend,
  resetToDefaults,
  savedTrends,
  updateSavedTrend,
  type SavedTrend,
} from '../../state/savedTrends'
import './style.css'

// Chart component for trend history
function TrendChart({ data, color }: { data: { date: string; value: number }[]; color: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

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
    const yRange = yExtent[1] - yExtent[0]
    const yPadding = yRange * 0.1 || 1
    const y = d3
      .scaleLinear()
      .domain([yExtent[0] - yPadding, yExtent[1] + yPadding])
      .nice()
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

    // X axis - show year when date range spans multiple years
    const dateExtent = d3.extent(parsedData, (d) => d.date) as [Date, Date]
    const spanYears = dateExtent[1].getFullYear() - dateExtent[0].getFullYear()
    const dateFormat = spanYears >= 1 ? d3.timeFormat("%b '%y") : d3.timeFormat('%b %d')

    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(6)
          .tickFormat((d) => dateFormat(d as Date)),
      )
      .selectAll('text')
      .attr('font-size', '11px')

    // Y axis
    g.append('g').call(d3.axisLeft(y).ticks(5)).selectAll('text').attr('font-size', '11px')

    // Tooltip crosshair and highlight
    const crosshair = g
      .append('line')
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', 'currentColor')
      .attr('stroke-opacity', 0.4)
      .attr('stroke-dasharray', '4 3')
      .attr('pointer-events', 'none')
      .style('display', 'none')

    const highlightDot = g
      .append('circle')
      .attr('r', 4)
      .attr('fill', color)
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .attr('pointer-events', 'none')
      .style('display', 'none')

    const bisector = d3.bisector<{ date: Date; value: number }, Date>((d) => d.date).left
    const tooltip = tooltipRef.current

    g.append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .attr('pointer-events', 'all')
      .on('mousemove', (event: MouseEvent) => {
        const [mx] = d3.pointer(event)
        const dateAtMouse = x.invert(mx)
        const idx = bisector(parsedData, dateAtMouse, 1)
        const d0 = parsedData[idx - 1]
        const d1 = parsedData[idx]
        if (!d0) return
        const nearest =
          d1 && dateAtMouse.getTime() - d0.date.getTime() > d1.date.getTime() - dateAtMouse.getTime()
            ? d1
            : d0
        const cx = x(nearest.date)
        const cy = y(nearest.value)

        crosshair.attr('x1', cx).attr('x2', cx).style('display', null)
        highlightDot.attr('cx', cx).attr('cy', cy).style('display', null)

        if (tooltip) {
          const dateLabel =
            spanYears >= 1 ? d3.timeFormat("%b %d, '%y")(nearest.date) : d3.timeFormat('%b %d')(nearest.date)
          tooltip.textContent = `${dateLabel}: ${nearest.value.toFixed(1)}`
          tooltip.style.display = 'block'

          const containerRect = container.getBoundingClientRect()
          const tooltipX = mx + margin.left
          const tooltipWidth = tooltip.offsetWidth
          const left =
            tooltipX + tooltipWidth + 12 > containerRect.width ? tooltipX - tooltipWidth - 12 : tooltipX + 12
          tooltip.style.left = `${left}px`
          tooltip.style.top = `${margin.top + 8}px`
        }
      })
      .on('mouseleave', () => {
        crosshair.style('display', 'none')
        highlightDot.style('display', 'none')
        if (tooltip) tooltip.style.display = 'none'
      })
  }, [data, color])

  if (data.length < 2) {
    return <div class="chart-placeholder">Insufficient data for chart</div>
  }

  return (
    <div ref={containerRef} class="trend-chart-container">
      <svg ref={svgRef} />
      <div class="trend-chart-tooltip" ref={tooltipRef} />
    </div>
  )
}

// Card showing current trend value
function TrendValueCard({ result }: { result: TrendResult }) {
  const { current_value, display_unit, pattern, source_type, half_life_days } = result

  return (
    <div class="trend-value-card">
      <div class="trend-current">
        <span class="trend-number">{current_value.toFixed(1)}</span>
        <span class="trend-unit">{display_unit}</span>
      </div>
      <div class="trend-meta">
        <span class="trend-pattern">{pattern}</span>
        <span class="trend-config">
          {source_type} · {half_life_days}d half-life
        </span>
      </div>
    </div>
  )
}

// Lookback options with extended range
const LOOKBACK_OPTIONS = [
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '180 days', value: 180 },
  { label: '1 year', value: 365 },
  { label: '2 years', value: 730 },
  { label: '3 years', value: 1095 },
  { label: '5 years', value: 1825 },
  { label: 'All time', value: 3650 }, // 10 years as "all time"
]

// Simple category picker using a select of all screentime categories
function CategoryPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: categories = [] } = useQuery({
    queryFn: fetchScreentimeCategories,
    queryKey: ['screentime-categories'],
    staleTime: 5 * 60 * 1000,
  })

  return (
    <select value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
      <option value="">Select a category...</option>
      {categories.map((cat) => (
        <option key={cat.id} value={cat.name.join(' > ')}>
          {cat.name.join(' > ')}
        </option>
      ))}
    </select>
  )
}

// Form for configuring a trend
// eslint-disable-next-line complexity -- TODO: refactor
function TrendConfigForm({
  initialValues,
  onSubmit,
  onCancel,
  isLoading,
  submitLabel = 'Calculate Trend',
}: {
  initialValues?: { name?: string; params: FetchTrendParams }
  onSubmit: (name: string, params: FetchTrendParams) => void
  onCancel?: () => void
  isLoading: boolean
  submitLabel?: string
}) {
  const [name, setName] = useState(initialValues?.name ?? '')
  const [sourceType, setSourceType] = useState<'tag' | 'metric' | 'productivity_category'>(
    initialValues?.params.source_type ?? 'tag',
  )
  const [pattern, setPattern] = useState(initialValues?.params.pattern ?? '')
  const [halfLifeDays, setHalfLifeDays] = useState(initialValues?.params.half_life_days ?? 15)
  const [lookbackDays, setLookbackDays] = useState(initialValues?.params.lookback_days ?? 90)
  const [displayPeriod, setDisplayPeriod] = useState<TrendDisplayPeriod>(
    initialValues?.params.display_period ?? 'monthly',
  )
  const [aggregation, setAggregation] = useState<'count' | 'mean' | 'sum'>(
    initialValues?.params.aggregation ?? 'count',
  )

  const handleSubmit = (e: Event) => {
    e.preventDefault()
    if (!pattern.trim()) return

    const trendName = name.trim() || pattern.trim()
    onSubmit(trendName, {
      aggregation: sourceType === 'metric' ? aggregation : 'count',
      display_period: displayPeriod,
      half_life_days: halfLifeDays,
      lookback_days: lookbackDays,
      pattern: pattern.trim(),
      source_type: sourceType,
    })
  }

  return (
    <form class="trend-config-form" onSubmit={handleSubmit}>
      <div class="form-row">
        <label class="name-input">
          Name
          <input
            type="text"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            placeholder="e.g., My Coffee Trend"
          />
        </label>
      </div>

      <div class="form-row">
        <label>
          Source Type
          <select
            value={sourceType}
            onChange={(e) =>
              setSourceType(
                (e.target as HTMLSelectElement).value as 'tag' | 'metric' | 'productivity_category',
              )
            }
          >
            <option value="tag">Tag</option>
            <option value="metric">Metric</option>
            <option value="productivity_category">Screentime Category</option>
          </select>
        </label>
        {sourceType === 'tag' ? (
          <label class="pattern-input">
            Tags
            <TagPicker
              selectedTags={pattern ? pattern.split('|').filter(Boolean) : []}
              onChange={(tags) => setPattern(tags.join('|'))}
            />
          </label>
        ) : sourceType === 'productivity_category' ? (
          <label class="pattern-input">
            Category
            <CategoryPicker value={pattern} onChange={setPattern} />
          </label>
        ) : (
          <label class="pattern-input">
            Metric
            <MetricPicker value={pattern} onChange={setPattern} placeholder="Search metrics..." />
          </label>
        )}
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
          Lookback
          <select
            value={lookbackDays}
            onChange={(e) => setLookbackDays(Number((e.target as HTMLSelectElement).value))}
          >
            {LOOKBACK_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
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

      <div class="form-actions">
        <button type="submit" disabled={isLoading || !pattern.trim()}>
          {isLoading ? 'Loading...' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" class="cancel-btn" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

// Widget color mapping
const getColor = (name: string): string => {
  const colors: Record<string, string> = {
    Coffee: '#78350f',
    Painkillers: '#dc2626',
    Weight: '#2563eb',
  }
  return colors[name] || '#8b5cf6'
}

// Single trend widget that displays a saved trend
function TrendWidget({
  trend,
  onEdit,
  onRemove,
}: {
  trend: SavedTrend
  onEdit: (trend: SavedTrend) => void
  onRemove: (id: string) => void
}) {
  const query = useQuery({
    queryFn: () => fetchTrend(trend.params),
    queryKey: ['trend', trend.params],
    staleTime: 5 * 60 * 1000,
  })

  const color = getColor(trend.name)

  if (query.isLoading) {
    return (
      <div class="trend-widget loading">
        <div class="trend-widget-header">
          <h3>{trend.name}</h3>
        </div>
        <div class="loading-spinner">Loading...</div>
      </div>
    )
  }

  if (query.error || !query.data) {
    return (
      <div class="trend-widget error">
        <div class="trend-widget-header">
          <h3>{trend.name}</h3>
          <div class="trend-widget-actions">
            <button class="edit-btn" onClick={() => onEdit(trend)} title="Edit">
              Edit
            </button>
            <button class="remove-btn" onClick={() => onRemove(trend.id)} title="Remove">
              ×
            </button>
          </div>
        </div>
        <div class="error-message">Failed to load trend data</div>
      </div>
    )
  }

  return (
    <div class="trend-widget">
      <div class="trend-widget-header">
        <h3>{trend.name}</h3>
        <div class="trend-widget-actions">
          <button class="edit-btn" onClick={() => onEdit(trend)} title="Edit">
            Edit
          </button>
          <button class="remove-btn" onClick={() => onRemove(trend.id)} title="Remove">
            ×
          </button>
        </div>
      </div>
      <TrendValueCard result={query.data} />
      <TrendChart data={query.data.history} color={color} />
    </div>
  )
}

// Main Trends page component
export function Trends() {
  const isLoggedIn = auth.value.token
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingTrend, setEditingTrend] = useState<SavedTrend | null>(null)

  const trends = savedTrends.value

  const handleAddTrend = (name: string, params: FetchTrendParams) => {
    addSavedTrend(name, params)
    setShowAddForm(false)
  }

  const handleEditTrend = (name: string, params: FetchTrendParams) => {
    if (editingTrend) {
      updateSavedTrend(editingTrend.id, name, params)
      setEditingTrend(null)
    }
  }

  const handleRemoveTrend = (id: string) => {
    if (confirm('Remove this trend from your dashboard?')) {
      removeSavedTrend(id)
    }
  }

  const handleResetToDefaults = () => {
    if (confirm('Reset all trends to the default presets? Your custom trends will be lost.')) {
      resetToDefaults()
    }
  }

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

      <section class="saved-trends">
        <div class="section-header">
          <h2>Your Trends</h2>
          <div class="section-actions">
            <button class="add-trend-btn" onClick={() => setShowAddForm(true)}>
              + Add Trend
            </button>
            <button class="reset-btn" onClick={handleResetToDefaults} title="Reset to defaults">
              Reset
            </button>
          </div>
        </div>

        {showAddForm && (
          <div class="add-trend-form-container">
            <h3>Add New Trend</h3>
            <TrendConfigForm
              onSubmit={handleAddTrend}
              onCancel={() => setShowAddForm(false)}
              isLoading={false}
              submitLabel="Add Trend"
            />
          </div>
        )}

        {editingTrend && (
          <div class="edit-trend-form-container">
            <h3>Edit Trend: {editingTrend.name}</h3>
            <TrendConfigForm
              initialValues={{ name: editingTrend.name, params: editingTrend.params }}
              onSubmit={handleEditTrend}
              onCancel={() => setEditingTrend(null)}
              isLoading={false}
              submitLabel="Save Changes"
            />
          </div>
        )}

        <div class="trends-grid">
          {trends.map((trend) => (
            <TrendWidget key={trend.id} trend={trend} onEdit={setEditingTrend} onRemove={handleRemoveTrend} />
          ))}
        </div>

        {trends.length === 0 && !showAddForm && (
          <div class="no-trends">
            <p>No trends configured. Add one to get started!</p>
            <button onClick={() => setShowAddForm(true)}>+ Add Your First Trend</button>
          </div>
        )}
      </section>
    </div>
  )
}
