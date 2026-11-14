import type { ActivityTypeCatalogResponse, ActivityTypeCatalogResult } from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

export const fetchActivityTypeCatalog = async (): Promise<ActivityTypeCatalogResult> => {
  const response = await axios.get<ActivityTypeCatalogResponse>(`${API_URL}/activity-type-catalog`, {
    headers: { Authorization: `Bearer ${auth.value.token}` },
  })
  return response.data.data ?? { entries: [], groups: [], version: '' }
}
