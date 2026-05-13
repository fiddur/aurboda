import type { ChartDataBucket, ChartDataResponse, ChartDataSourceType } from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

export interface FetchChartDataParams {
  source_type: ChartDataSourceType
  start: string
  end: string
  pattern?: string
  activity_type_id?: string
  bucket_size?: '1m' | '5m' | '15m' | '1h' | '1d' | '1w' | '1M'
  aggregation?: 'count' | 'sum' | 'mean'
  breakdown_fields?: string[]
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
  }
  if (params.pattern) query.pattern = params.pattern
  if (params.activity_type_id) query.tag_definition_id = params.activity_type_id
  if (params.bucket_size) query.bucket_size = params.bucket_size
  if (params.aggregation) query.aggregation = params.aggregation
  if (params.breakdown_fields?.length) query.breakdown_fields = params.breakdown_fields.join(',')

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
