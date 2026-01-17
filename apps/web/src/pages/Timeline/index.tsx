import { signal } from '@preact/signals'
import { useQuery } from '@tanstack/react-query'
import * as d3 from 'd3'
import { endOfDay, formatISO, startOfDay, subDays } from 'date-fns'
import { fetchHeartRate } from '../../state/api'
import { preprocessData } from '../../utils/chart'

// Signals to handle user-selected dates
const fromDate = signal(formatISO(subDays(new Date(), 1), { representation: 'date' }))
const toDate = signal(formatISO(new Date(), { representation: 'date' }))

export const Timeline = () => {
  // Use TanStack Query to fetch heart rate data
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['heartRate', fromDate.value, toDate.value],
    queryFn: () =>
      fetchHeartRate(startOfDay(new Date(fromDate.value)), endOfDay(new Date(toDate.value))),
    staleTime: 10 * 60 * 1000,
  })

  const handleDateChange = (e: Event) => {
    const target = e.target as HTMLInputElement
    if (target.name === 'from') fromDate.value = target.value
    else if (target.name === 'to') toDate.value = target.value
    refetch()
  }

  if (isLoading) return <div>Loading Heart Rate...</div>
  if (isError) return <div>Error: {(error as Error).message}</div>

  return (
    <>
      <div class="timeline">
        <h1>Heart Rate Timeline</h1>
        <div>
          <label>
            From:{' '}
            <input type="date" name="from" value={fromDate.value} onChange={handleDateChange} />
          </label>
          <label>
            To: <input type="date" name="to" value={toDate.value} onChange={handleDateChange} />
          </label>
        </div>
        <LineChart data={data || []} />
      </div>
    </>
  )
}

function LineChart({ data }: { data: [Date, number][] }) {
  const margin = { top: 10, right: 20, bottom: 20, left: 30 }
  const width = 800
  const height = 400

  const x = d3
    .scaleTime()
    .domain(d3.extent(data, ([time]) => time) as [Date, Date])
    .range([margin.left, width - margin.right])

  const y = d3
    .scaleLinear()
    .domain([40, d3.max(data, ([, rate]) => rate)] as [number, number])
    .range([height - margin.bottom, margin.top])

  return (
    <svg width={width} height={height}>
      <path
        fill="none"
        stroke="red"
        strokeWidth="2"
        d={d3
          .line<[Date, number] | null>()
          .defined(Boolean)
          .x(([time]) => x(time))
          .y(([, rate]) => y(rate))(preprocessData(data, 10))}
      />
      <g
        transform={`translate(${margin.left},0)`}
        ref={(g) => {
          if (g) d3.select(g).call(d3.axisLeft(y))
        }}
      />
      <g
        transform={`translate(0,${height - margin.bottom})`}
        ref={(g) => {
          if (g) d3.select(g).call(d3.axisBottom(x))
        }}
      />
    </svg>
  )
}
