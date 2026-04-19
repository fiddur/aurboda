import type { ScreentimeCategory } from '@aurboda/api-spec'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { addDays, format, subDays } from 'date-fns'
import { useCallback, useMemo } from 'preact/hooks'

import type { Activity } from '../../state/api'
import type { ChartItem, Column } from './types'

import {
  fetchActivities,
  fetchActivityTypeDefinitions,
  fetchBucketedMetrics,
  fetchMeals,
  fetchPlaces,
  fetchProductivity,
  fetchScreentimeCategories,
  fetchScreentimeBucketed,
  fetchScrobbles,
  fetchItemIcons,
  fetchTrainingLoad,
  fetchUserSettings,
} from '../../state/api'
import { parseBucketedResponse } from '../../utils/chart'
import { packLanes } from '../../utils/lanePacking'
import {
  buildActivityColumnItems,
  EXCLUDED_ACTIVITY_PREFIXES,
  EXCLUDED_ACTIVITY_SOURCES,
  EXCLUDED_ACTIVITY_TYPES,
} from './activityMerge'
import {
  categorizeLocations,
  categorizeMeals,
  categorizeOtherActivities,
  categorizeProductivity,
} from './categorize'
import { categorizeMusic } from './categorizeMusic'
import { activityColors, getExerciseColor } from './colors'
import { parseBucketedData } from './drawActivitySparklines'
import { getExerciseTypeName } from './formatting'
import { BASE_COLUMNS, CATEGORY_MATCHERS, type LegendCategory } from './legendCategories'
import { buildSleepDetails, type SleepMetricsByDate } from './tooltipBuilder'

/** Metrics to exclude from the unified bucketed query (fetched via separate endpoints). */
const TIMELINE_EXCLUDED_METRICS = ['training_impulse', 'activity_impulse']

const ACTIVITY_CATEGORIES = new Set(['sleep_rest', 'exercise', 'meditation', 'wellness'])

export interface TimelineData {
  // Raw query results needed by rendering
  activities: Activity[]
  scrobbles: ReturnType<typeof fetchScrobbles> extends Promise<infer T> ? T : never
  // Derived chart data
  chartItems: ChartItem[]
  activityItems: ChartItem[]
  columnData: { column: Column; items: { item: ChartItem; lane: number }[]; laneCount: number }[]
  columns: Column[]
  sparklineBuckets: ReturnType<typeof parseBucketedData>
  horizontalMetricBuckets: ReturnType<typeof parseBucketedResponse>
  // Query objects needed for horizontal mode
  trainingLoadQuery: ReturnType<typeof useQuery<Awaited<ReturnType<typeof fetchTrainingLoad>>>>
  screentimeBucketedQuery: ReturnType<typeof useQuery<Awaited<ReturnType<typeof fetchScreentimeBucketed>>>>
  screentimeCategoriesQuery: ReturnType<typeof useQuery<ScreentimeCategory[]>>
  // Status
  isFetching: boolean
  isInitialLoad: boolean
  errorSources: string[]
  // Misc
  hasLastFm: boolean
}

export interface UseTimelineDataOptions {
  fetchStart: Date
  fetchEnd: Date
  fromDateKey: string
  toDateKey: string
  hiddenCategories: Set<LegendCategory>
  bucketSize: string
  barBucketSize: '1h' | '1d' | '1w'
  screentimeMergeGapMs: number
}

// eslint-disable-next-line complexity -- data hook aggregating multiple queries
export const useTimelineData = ({
  fetchStart,
  fetchEnd,
  fromDateKey,
  toDateKey,
  hiddenCategories,
  bucketSize,
  barBucketSize,
  screentimeMergeGapMs,
}: UseTimelineDataOptions): TimelineData => {
  // ── Data queries ───────────────────────────────────────────────────────────

  const { data: activityTypeDefs = [] } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activityTypeDefinitions'],
    staleTime: 5 * 60_000,
  })

  const activitiesQuery = useQuery({
    enabled: !hiddenCategories.has('activity'),
    placeholderData: keepPreviousData,
    queryFn: () => fetchActivities(subDays(fetchStart, 0.5), addDays(fetchEnd, 0.5)),
    queryKey: ['timeline-activities', fromDateKey, toDateKey],
    staleTime: 5 * 60 * 1000,
  })

  const placesQuery = useQuery({
    enabled: !hiddenCategories.has('location'),
    placeholderData: keepPreviousData,
    queryFn: () => fetchPlaces(subDays(fetchStart, 0.5), addDays(fetchEnd, 0.5)),
    queryKey: ['timeline-places', fromDateKey, toDateKey],
    staleTime: 5 * 60 * 1000,
  })

  const mealsQuery = useQuery({
    enabled: !hiddenCategories.has('activity') && !hiddenCategories.has('meal'),
    placeholderData: keepPreviousData,
    queryFn: () => fetchMeals({ start: fetchStart.toISOString(), end: fetchEnd.toISOString() }),
    queryKey: ['timeline-meals', fromDateKey, toDateKey],
    staleTime: 5 * 60 * 1000,
  })

  const productivityQuery = useQuery({
    enabled: !hiddenCategories.has('activity') && !hiddenCategories.has('screentime'),
    placeholderData: keepPreviousData,
    queryFn: () => fetchProductivity(fetchStart, fetchEnd, 'category', screentimeMergeGapMs),
    queryKey: ['timeline-productivity', fromDateKey, toDateKey, screentimeMergeGapMs],
    staleTime: 5 * 60 * 1000,
  })

  const screentimeCategoriesQuery = useQuery<ScreentimeCategory[]>({
    enabled: !hiddenCategories.has('activity') && !hiddenCategories.has('screentime'),
    queryFn: fetchScreentimeCategories,
    queryKey: ['screentime-categories'],
    staleTime: 30 * 60 * 1000,
  })

  const settingsQuery = useQuery({
    queryFn: fetchUserSettings,
    queryKey: ['user-settings'],
    staleTime: 30 * 60 * 1000,
  })

  const hasLastFm = Boolean(settingsQuery.data?.lastfm_username)

  const scrobblesQuery = useQuery({
    enabled: hasLastFm && !hiddenCategories.has('music'),
    placeholderData: keepPreviousData,
    queryFn: () => fetchScrobbles(subDays(fetchStart, 0.5), addDays(fetchEnd, 0.5)),
    queryKey: ['timeline-scrobbles', fromDateKey, toDateKey],
    staleTime: 5 * 60 * 1000,
  })

  const bucketedMetricsQuery = useQuery({
    enabled: !hiddenCategories.has('metrics'),
    placeholderData: keepPreviousData,
    queryFn: () =>
      fetchBucketedMetrics(
        subDays(fetchStart, 0.5),
        addDays(fetchEnd, 0.5),
        undefined,
        bucketSize,
        TIMELINE_EXCLUDED_METRICS,
      ),
    queryKey: ['timeline-bucketed-metrics', fromDateKey, toDateKey, bucketSize],
    staleTime: 5 * 60 * 1000,
  })

  const itemIconsQuery = useQuery({
    queryFn: fetchItemIcons,
    queryKey: ['item-icons'],
    staleTime: 30 * 60 * 1000,
  })

  const trainingLoadQuery = useQuery({
    enabled: !hiddenCategories.has('training_load'),
    placeholderData: keepPreviousData,
    queryFn: () => fetchTrainingLoad(subDays(fetchStart, 0.5), addDays(fetchEnd, 0.5), barBucketSize),
    queryKey: ['timeline-training-load', fromDateKey, toDateKey, barBucketSize],
    staleTime: 5 * 60 * 1000,
  })

  const screentimeBucketedQuery = useQuery({
    enabled: !hiddenCategories.has('screen_time_h') && !hiddenCategories.has('metrics'),
    placeholderData: keepPreviousData,
    queryFn: () => fetchScreentimeBucketed(subDays(fetchStart, 0.5), addDays(fetchEnd, 0.5), barBucketSize),
    queryKey: ['timeline-screentime-bucketed', fromDateKey, toDateKey, barBucketSize],
    staleTime: 5 * 60 * 1000,
  })

  // ── Derived data ───────────────────────────────────────────────────────────

  const typeDefsMap = useMemo(
    () =>
      new Map(
        activityTypeDefs.map((t) => [t.name, { color: t.color, display_name: t.display_name, icon: t.icon }]),
      ),
    [activityTypeDefs],
  )
  const hiddenTypes = useMemo(
    () => new Set(activityTypeDefs.filter((t) => !t.show_on_timeline).map((t) => t.name)),
    [activityTypeDefs],
  )

  const categoryByType = useMemo(
    () => new Map(activityTypeDefs.map((t) => [t.name, t.display_category])),
    [activityTypeDefs],
  )
  const allActivities = useMemo(
    () => (activitiesQuery.data ?? []).filter((a) => !hiddenTypes.has(a.activity_type ?? '')),
    [activitiesQuery.data, hiddenTypes],
  )
  const activities = useMemo(
    () =>
      allActivities.filter((a) => ACTIVITY_CATEGORIES.has(categoryByType.get(a.activity_type) ?? 'other')),
    [allActivities, categoryByType],
  )
  const secondaryActivities = useMemo(
    () =>
      allActivities.filter((a) => !ACTIVITY_CATEGORIES.has(categoryByType.get(a.activity_type) ?? 'other')),
    [allActivities, categoryByType],
  )
  const places = placesQuery.data ?? []
  const productivity = productivityQuery.data?.records ?? []
  const scrobbles = scrobblesQuery.data ?? []

  const sleepMetricsByDate = useMemo<SleepMetricsByDate>(() => {
    const map: SleepMetricsByDate = new Map()
    const sleepMetricNames = [
      'sleep_score',
      'sleep_efficiency',
      'sleep_restfulness',
      'sleep_deep_score',
      'sleep_rem_score',
    ]
    for (const bucket of bucketedMetricsQuery.data?.buckets ?? []) {
      for (const name of sleepMetricNames) {
        const stats = bucket.metrics[name]
        if (!stats) continue
        const key = format(new Date(bucket.start), 'yyyy-MM-dd')
        const existing = map.get(key) ?? {}
        existing[name] = stats.avg
        map.set(key, existing)
      }
    }
    return map
  }, [bucketedMetricsQuery.data])

  const itemIcons = useMemo<Record<string, string>>(() => {
    return itemIconsQuery.data ?? {}
  }, [itemIconsQuery.data])

  const musicItems = useMemo(() => (hasLastFm ? categorizeMusic(scrobbles) : []), [hasLastFm, scrobbles])
  const showMusicColumn = musicItems.length > 0

  const sparklineBuckets = useMemo(
    () => parseBucketedData(bucketedMetricsQuery.data),
    [bucketedMetricsQuery.data],
  )

  const horizontalMetricBuckets = useMemo(
    () => parseBucketedResponse(bucketedMetricsQuery.data),
    [bucketedMetricsQuery.data],
  )

  const uniquePlaceNames = useMemo(
    () => [...new Set(places.map((p) => p.region))].filter(Boolean).sort(),
    [places],
  )

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- UI temporarily commented out, will be redesigned
  const { items: activityItems, overlaps: overlapWarnings } = useMemo(
    () =>
      buildActivityColumnItems(
        activities,
        secondaryActivities,
        itemIcons,
        activityColors,
        getExerciseColor,
        getExerciseTypeName,
        sleepMetricsByDate,
        (a, end) => buildSleepDetails(a, end, sleepMetricsByDate),
        scrobbles,
        typeDefsMap,
      ),
    [activities, secondaryActivities, itemIcons, sleepMetricsByDate, scrobbles, typeDefsMap],
  )

  const otherActivities = useMemo(
    () =>
      secondaryActivities.filter((a) => {
        if (!a.end_time) return true
        if (a.source && EXCLUDED_ACTIVITY_SOURCES.has(a.source)) return true
        if (EXCLUDED_ACTIVITY_TYPES.has(a.activity_type)) return true
        for (const prefix of EXCLUDED_ACTIVITY_PREFIXES) {
          if (a.activity_type.startsWith(prefix)) return true
        }
        return !activityItems.some((i) => i.entity_id === a.id)
      }),
    [secondaryActivities, activityItems],
  )

  const allColumns: Column[] = useMemo(
    () => (showMusicColumn ? [...BASE_COLUMNS, 'Music'] : BASE_COLUMNS),
    [showMusicColumn],
  )

  const mealItems = useMemo(
    () => categorizeMeals(mealsQuery.data?.meals ?? [], itemIcons),
    [mealsQuery.data, itemIcons],
  )

  const isItemHidden = useCallback(
    (item: ChartItem): boolean => {
      if (hiddenCategories.has('activity') && CATEGORY_MATCHERS.activity(item)) return true
      if (hiddenCategories.has('location') && CATEGORY_MATCHERS.location(item)) return true
      if (hiddenCategories.has('music') && CATEGORY_MATCHERS.music(item)) return true
      for (const cat of hiddenCategories) {
        if (cat === 'activity' || cat === 'location' || cat === 'music' || cat === 'metrics') continue
        if (CATEGORY_MATCHERS[cat](item)) return true
      }
      return false
    },
    [hiddenCategories],
  )

  const allChartItems = useMemo(
    () => [
      ...activityItems,
      ...categorizeLocations(places, uniquePlaceNames),
      ...categorizeOtherActivities(otherActivities, itemIcons, typeDefsMap),
      ...categorizeProductivity(productivity, screentimeCategoriesQuery.data ?? [], itemIcons),
      ...musicItems,
      ...mealItems,
    ],
    [
      activityItems,
      places,
      uniquePlaceNames,
      otherActivities,
      itemIcons,
      typeDefsMap,
      productivity,
      screentimeCategoriesQuery.data,
      musicItems,
      mealItems,
    ],
  )

  const chartItems = useMemo(
    () => allChartItems.filter((item) => !isItemHidden(item)),
    [allChartItems, isItemHidden],
  )

  const columns = useMemo(
    () => allColumns.filter((col) => chartItems.some((item) => item.column === col)),
    [allColumns, chartItems],
  )

  const columnData = useMemo(
    () =>
      columns.map((col) => {
        const colItems = chartItems.filter((i) => i.column === col)
        const packed = packLanes(
          colItems,
          (i) => i.start,
          (i) => (i.isPoint ? undefined : i.end),
        )
        return { column: col, ...packed }
      }),
    [columns, chartItems],
  )

  const isFetching =
    activitiesQuery.isFetching ||
    placesQuery.isFetching ||
    mealsQuery.isFetching ||
    productivityQuery.isFetching ||
    scrobblesQuery.isFetching ||
    bucketedMetricsQuery.isFetching

  const isInitialLoad = activitiesQuery.isLoading && placesQuery.isLoading && productivityQuery.isLoading

  const errorSources = [
    activitiesQuery.isError && 'activities',
    placesQuery.isError && 'places',
    productivityQuery.isError && 'screen time',
  ].filter(Boolean) as string[]

  return {
    activities,
    activityItems,
    chartItems,
    columnData,
    columns,
    errorSources,
    hasLastFm,
    horizontalMetricBuckets,
    isFetching,
    isInitialLoad,
    screentimeBucketedQuery,
    screentimeCategoriesQuery,
    scrobbles,
    sparklineBuckets,
    trainingLoadQuery,
  }
}
