import type { DataSourcesOverview, DataSourcesOverviewResponse } from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

export const fetchDataSourcesOverview = async (): Promise<DataSourcesOverview> => {
  const { token } = auth.value
  const response = await axios.get<DataSourcesOverviewResponse>(`${API_URL}/data-sources/overview`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const { groups, kinds, sources } = response.data
  return { groups, kinds, sources }
}
