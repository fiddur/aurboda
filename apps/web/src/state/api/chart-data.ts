import type {
  ActivityMeasure,
  ChartDataAggregation,
  ChartDataBucket,
  ChartDataResponse,
  ChartDataSourceType,
  ChartFirstDayQuery,
  ChartFirstDayResponse,
  JournalChartFilters,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'
import { browserTz } from './client'
import { setJournalFilters } from './journal-chart-params'

export interface FetchChartDataParams extends JournalChartFilters {
  source_type: ChartDataSourceType
  start: string
  end: string
  pattern?: string
  activity_type_id?: string
  bucket_size?: '1m' | '5m' | '15m' | '1h' | '1d' | '1w' | '1M'
  aggregation?: ChartDataAggregation
  breakdown_fields?: string[]
  measure?: ActivityMeasure
  filter_field?: string
  filter_value?: string
}

export interface ChartDataResult {
  buckets: ChartDataBucket[]
  breakdown_fields?: string[]
  breakdown_series?: string[]
  breakdown_buckets?: Array<{ bucket_start: string; series: Record<string, number> }>
}

export const fetchChartData = async (params: FetchChartDataParams): Promise<ChartDataResult> => {
  const { token } = auth.value
  const query: Record<string, string> = {
    source_type: params.source_type,
    start: params.start,
    end: params.end,
    tz: browserTz,
  }
  if (params.pattern) query.pattern = params.pattern
  if (params.activity_type_id) query.tag_definition_id = params.activity_type_id
  if (params.bucket_size) query.bucket_size = params.bucket_size
  if (params.aggregation) query.aggregation = params.aggregation
  if (params.breakdown_fields?.length) query.breakdown_fields = params.breakdown_fields.join(',')
  if (params.measure) query.measure = params.measure
  if (params.filter_field && params.filter_value) {
    query.filter_field = params.filter_field
    query.filter_value = params.filter_value
  }
  setJournalFilters(query, params)

  const response = await axios.get<ChartDataResponse>(`${API_URL}/chart-data`, {
    headers: { Authorization: `Bearer ${token}` },
    params: query,
  })

  const data = response.data.data
  if (data?.breakdown_fields?.length) {
    return {
      breakdown_buckets: data.buckets as Array<{ bucket_start: string; series: Record<string, number> }>,
      breakdown_fields: data.breakdown_fields,
      breakdown_series: data.breakdown_series,
      buckets: [],
    }
  }

  return { buckets: (data?.buckets ?? []) as ChartDataBucket[] }
}

export interface ChartFirstDayParams extends JournalChartFilters {
  activity_type_id?: string
  pattern?: string
  source_type: ChartDataSourceType
}

/** The first local day with data for a chart source, where its all-time range starts; absent without data. */
export const fetchChartFirstDay = async (params: ChartFirstDayParams): Promise<{ first_day?: string }> => {
  const { token } = auth.value
  const query: ChartFirstDayQuery = { source_type: params.source_type, tz: browserTz }
  if (params.pattern) query.pattern = params.pattern
  if (params.activity_type_id) query.activity_type_id = params.activity_type_id
  setJournalFilters(query, params)

  const response = await axios.get<ChartFirstDayResponse>(`${API_URL}/chart-data/first-day`, {
    headers: { Authorization: `Bearer ${token}` },
    params: query,
  })
  return response.data.data ?? {}
}
