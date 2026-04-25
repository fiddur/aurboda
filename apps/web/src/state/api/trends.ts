import type {
  TrendDisplayPeriod,
  TrendQuery,
  TrendResponse,
  TrendResult,
  TrendSourceType,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

export interface FetchTrendParams {
  source_type: TrendSourceType
  pattern: string
  half_life_days?: number
  lookback_days?: number
  display_period?: TrendDisplayPeriod
  aggregation?: 'count' | 'sum' | 'mean'
  activity_type_id?: string
  breakdown_fields?: string[]
}

// Fetch trend data with EMA calculation
export const fetchTrend = async (params: FetchTrendParams): Promise<TrendResult> => {
  const { token } = auth.value
  // Only include defined values to avoid sending empty strings
  const query: Partial<TrendQuery> = {
    pattern: params.pattern,
    source_type: params.source_type,
  }
  if (params.aggregation) query.aggregation = params.aggregation
  if (params.display_period) query.display_period = params.display_period
  if (params.half_life_days) query.half_life_days = params.half_life_days.toString()
  if (params.lookback_days) query.lookback_days = params.lookback_days.toString()
  if (params.activity_type_id) query.tag_definition_id = params.activity_type_id
  if (params.breakdown_fields?.length) query.breakdown_fields = params.breakdown_fields.join(',')

  const response = await axios.get<TrendResponse>(`${API_URL}/trends`, {
    headers: { Authorization: `Bearer ${token}` },
    params: query,
  })

  return response.data.data!
}
