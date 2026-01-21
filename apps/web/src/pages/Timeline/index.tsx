import { signal } from '@preact/signals'
import { useQuery } from '@tanstack/react-query'
import * as d3 from 'd3'
import { endOfDay, formatISO, startOfDay, subDays } from 'date-fns'
import {
  Activity,
  fetchActivities,
  fetchHeartRate,
  fetchPlaces,
  fetchProductivity,
  fetchTags,
  Place,
  ProductivityRecord,
  Tag,
} from '../../state/api'
import { preprocessData } from '../../utils/chart'

// Signals to handle user-selected dates
const fromDate = signal(formatISO(subDays(new Date(), 1), { representation: 'date' }))
const toDate = signal(formatISO(new Date(), { representation: 'date' }))

// Signals for toggling data layers
const showHeartRate = signal(true)
const showSleep = signal(true)
const showExercise = signal(true)
const showMeditation = signal(true)
const showProductivity = signal(true)
const showPlaces = signal(true)
const showTags = signal(true)

// Legend configuration
const legendItems = [
  { color: 'red', label: 'Heart Rate', signal: showHeartRate },
  { color: 'rgba(0, 0, 255, 0.3)', label: 'Sleep', signal: showSleep },
  { color: 'rgba(0, 128, 0, 0.4)', label: 'Exercise', signal: showExercise },
  { color: 'rgba(128, 0, 128, 0.6)', label: 'Meditation', signal: showMeditation },
  { color: 'darkblue', label: 'Computer', signal: showProductivity },
  { color: 'darkcyan', label: 'Mobile', signal: showProductivity },
  { color: 'lightgray', label: 'Places', signal: showPlaces },
  { color: 'black', label: 'Tags', signal: showTags },
]

export const Timeline = () => {
  const start = startOfDay(new Date(fromDate.value))
  const end = endOfDay(new Date(toDate.value))

  const heartRateQuery = useQuery({
    enabled: showHeartRate.value,
    queryFn: () => fetchHeartRate(start, end),
    queryKey: ['heartRate', fromDate.value, toDate.value],
    staleTime: 10 * 60 * 1000,
  })

  const activitiesQuery = useQuery({
    enabled: showSleep.value || showExercise.value || showMeditation.value,
    queryFn: () => fetchActivities(start, end),
    queryKey: ['activities', fromDate.value, toDate.value],
    staleTime: 10 * 60 * 1000,
  })

  const productivityQuery = useQuery({
    enabled: showProductivity.value,
    queryFn: () => fetchProductivity(start, end),
    queryKey: ['productivity', fromDate.value, toDate.value],
    staleTime: 10 * 60 * 1000,
  })

  const placesQuery = useQuery({
    enabled: showPlaces.value,
    queryFn: () => fetchPlaces(start, end),
    queryKey: ['places', fromDate.value, toDate.value],
    staleTime: 10 * 60 * 1000,
  })

  const tagsQuery = useQuery({
    enabled: showTags.value,
    queryFn: () => fetchTags(start, end),
    queryKey: ['tags', fromDate.value, toDate.value],
    staleTime: 10 * 60 * 1000,
  })

  const handleDateChange = (e: Event) => {
    const target = e.target as HTMLInputElement
    if (target.name === 'from') fromDate.value = target.value
    else if (target.name === 'to') toDate.value = target.value
  }

  const isLoading =
    heartRateQuery.isLoading ||
    activitiesQuery.isLoading ||
    productivityQuery.isLoading ||
    placesQuery.isLoading ||
    tagsQuery.isLoading

  const hasError =
    heartRateQuery.isError ||
    activitiesQuery.isError ||
    productivityQuery.isError ||
    placesQuery.isError ||
    tagsQuery.isError

  return (
    <>
      <div class="timeline">
        <h1>Timeline</h1>
        <div style={{ display: 'flex', gap: '2rem', marginBottom: '1rem' }}>
          <div>
            <label>
              From: <input type="date" name="from" value={fromDate.value} onChange={handleDateChange} />
            </label>
            <label style={{ marginLeft: '1rem' }}>
              To: <input type="date" name="to" value={toDate.value} onChange={handleDateChange} />
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
          <label>
            <input
              type="checkbox"
              checked={showHeartRate.value}
              onChange={(e) => (showHeartRate.value = (e.target as HTMLInputElement).checked)}
            />
            Heart Rate
          </label>
          <label>
            <input
              type="checkbox"
              checked={showSleep.value}
              onChange={(e) => (showSleep.value = (e.target as HTMLInputElement).checked)}
            />
            Sleep
          </label>
          <label>
            <input
              type="checkbox"
              checked={showExercise.value}
              onChange={(e) => (showExercise.value = (e.target as HTMLInputElement).checked)}
            />
            Exercise
          </label>
          <label>
            <input
              type="checkbox"
              checked={showMeditation.value}
              onChange={(e) => (showMeditation.value = (e.target as HTMLInputElement).checked)}
            />
            Meditation
          </label>
          <label>
            <input
              type="checkbox"
              checked={showProductivity.value}
              onChange={(e) => (showProductivity.value = (e.target as HTMLInputElement).checked)}
            />
            Productivity
          </label>
          <label>
            <input
              type="checkbox"
              checked={showPlaces.value}
              onChange={(e) => (showPlaces.value = (e.target as HTMLInputElement).checked)}
            />
            Places
          </label>
          <label>
            <input
              type="checkbox"
              checked={showTags.value}
              onChange={(e) => (showTags.value = (e.target as HTMLInputElement).checked)}
            />
            Tags
          </label>
        </div>

        <Legend />

        {isLoading && <div>Loading...</div>}
        {hasError && <div>Error loading data</div>}

        <TimelineChart
          heartRates={showHeartRate.value ? heartRateQuery.data || [] : []}
          activities={activitiesQuery.data || []}
          productivity={showProductivity.value ? productivityQuery.data || [] : []}
          places={showPlaces.value ? placesQuery.data || [] : []}
          tags={showTags.value ? tagsQuery.data || [] : []}
          sleepVisible={showSleep.value}
          exerciseVisible={showExercise.value}
          meditationVisible={showMeditation.value}
          start={start}
          end={end}
        />
      </div>
    </>
  )
}

function Legend() {
  return (
    <div
      style={{
        border: '1px solid #ccc',
        borderRadius: '4px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '1rem',
        marginBottom: '1rem',
        padding: '0.5rem 1rem',
      }}
    >
      <strong>Legend:</strong>
      {legendItems.map((item) => (
        <div key={item.label} style={{ alignItems: 'center', display: 'flex', gap: '0.25rem' }}>
          <div
            style={{
              backgroundColor: item.color,
              border: item.label === 'Tags' ? '1px dashed black' : 'none',
              height: '12px',
              width: '20px',
            }}
          />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  )
}

interface TimelineChartProps {
  heartRates: [Date, number][]
  activities: Activity[]
  productivity: ProductivityRecord[]
  places: Place[]
  tags: Tag[]
  sleepVisible: boolean
  exerciseVisible: boolean
  meditationVisible: boolean
  start: Date
  end: Date
}

function TimelineChart({
  heartRates,
  activities,
  productivity,
  places,
  tags,
  sleepVisible,
  exerciseVisible,
  meditationVisible,
  start,
  end,
}: TimelineChartProps) {
  const margin = { bottom: 30, left: 40, right: 20, top: 10 }
  const width = 1000
  const height = 500

  const chartWidth = width - margin.left - margin.right
  const chartHeight = height - margin.top - margin.bottom

  // Track heights for different data layers
  const trackHeight = chartHeight / 8
  const trackComputer = 0
  const trackMobile = trackHeight
  const trackExercise = 2 * trackHeight
  const trackPlaces = 3 * trackHeight

  // Time scale
  const x = d3.scaleTime().domain([start, end]).range([0, chartWidth])

  // Heart rate y scale
  const y = d3.scaleLinear().domain([40, 200]).range([chartHeight, 0])

  // Place colors
  const placeColors: Record<string, string> = {
    Genki: 'darkgrey',
    Hökås: 'lightgreen',
    Lönnåsen: 'olive',
  }

  // Filter activities by type
  const sleepSessions = sleepVisible ? activities.filter((a) => a.activityType === 'sleep') : []
  const exerciseSessions = exerciseVisible ? activities.filter((a) => a.activityType === 'exercise') : []
  const meditationSessions =
    meditationVisible ? activities.filter((a) => a.activityType === 'meditation') : []

  return (
    <svg width={width} height={height}>
      <g transform={`translate(${margin.left},${margin.top})`}>
        {/* Sleep sessions - full height blue background */}
        {sleepSessions.map((session, i) =>
          session.endTime ?
            <rect
              key={`sleep-${i}`}
              x={x(session.startTime)}
              y={0}
              width={Math.max(0, x(session.endTime) - x(session.startTime))}
              height={chartHeight}
              fill="blue"
              opacity={0.2}
            />
          : null,
        )}

        {/* Meditation sessions - full height purple background */}
        {meditationSessions.map((session, i) =>
          session.endTime ?
            <rect
              key={`meditation-${i}`}
              x={x(session.startTime)}
              y={0}
              width={Math.max(0, x(session.endTime) - x(session.startTime))}
              height={chartHeight}
              fill="purple"
              opacity={0.6}
            />
          : null,
        )}

        {/* Productivity (Computer) - track 0 */}
        {productivity
          .filter((p) => !p.isMobile)
          .map((p, i) => (
            <rect
              key={`computer-${i}`}
              x={x(p.startTime)}
              y={trackComputer}
              width={Math.max(0, x(p.endTime) - x(p.startTime))}
              height={trackHeight}
              fill="darkblue"
              opacity={0.8}
            />
          ))}

        {/* Productivity (Mobile) - track 1 */}
        {productivity
          .filter((p) => p.isMobile)
          .map((p, i) => (
            <rect
              key={`mobile-${i}`}
              x={x(p.startTime)}
              y={trackMobile}
              width={Math.max(0, x(p.endTime) - x(p.startTime))}
              height={trackHeight}
              fill="darkcyan"
              opacity={0.8}
            />
          ))}

        {/* Exercise sessions - track 2 */}
        {exerciseSessions.map((session, i) =>
          session.endTime ?
            <rect
              key={`exercise-${i}`}
              x={x(session.startTime)}
              y={trackExercise}
              width={Math.max(0, x(session.endTime) - x(session.startTime))}
              height={trackHeight}
              fill="green"
              opacity={0.4}
            />
          : null,
        )}

        {/* Places - track 3 */}
        {places.map((place, i) => (
          <rect
            key={`place-${i}`}
            x={x(place.startTime)}
            y={trackPlaces}
            width={Math.max(0, x(place.endTime) - x(place.startTime))}
            height={trackHeight}
            fill={placeColors[place.region] || 'lightgray'}
          />
        ))}

        {/* Tags - dashed lines or rectangles */}
        {tags.map((tag, i) =>
          tag.endTime ?
            <rect
              key={`tag-${i}`}
              x={x(tag.startTime)}
              y={0}
              width={Math.max(0, x(tag.endTime) - x(tag.startTime))}
              height={chartHeight}
              fill="none"
              stroke="black"
              strokeDasharray="4"
              opacity={0.3}
            />
          : <line
              key={`tag-${i}`}
              x1={x(tag.startTime)}
              y1={0}
              x2={x(tag.startTime)}
              y2={chartHeight}
              stroke="black"
              strokeDasharray="4"
              opacity={0.3}
            />,
        )}

        {/* Heart Rate Line */}
        {heartRates.length > 0 && (
          <path
            fill="none"
            stroke="red"
            strokeWidth="1.5"
            d={
              d3
                .line<[Date, number] | null>()
                .defined(Boolean)
                .x(([time]) => x(time))
                .y(([, rate]) => y(rate))(preprocessData(heartRates, 10)) || ''
            }
          />
        )}

        {/* Y-axis for heart rate */}
        <g
          ref={(g) => {
            if (g) d3.select(g).call(d3.axisLeft(y))
          }}
        />

        {/* X-axis */}
        <g
          transform={`translate(0,${chartHeight})`}
          ref={(g) => {
            if (g)
              d3.select(g).call(
                d3
                  .axisBottom(x)
                  .ticks(d3.timeHour.every(6))
                  .tickFormat((d) => d3.timeFormat('%a %H')(d as Date)),
              )
          }}
        />
      </g>
    </svg>
  )
}
