import type { MetricCatalogResponse, MetricCatalogResult } from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

export const fetchMetricCatalog = async (): Promise<MetricCatalogResult> => {
  const response = await axios.get<MetricCatalogResponse>(`${API_URL}/metric-catalog`, {
    headers: { Authorization: `Bearer ${auth.value.token}` },
  })
  return response.data.data ?? { entries: [], groups: [], version: '' }
}
