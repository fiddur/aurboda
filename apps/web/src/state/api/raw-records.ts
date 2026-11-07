import type { QueryRawRecordsQuery, QueryRawRecordsResponse } from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

/** How many raw records match, fetching at most one of them. */
export const fetchRawRecordCount = async (query: Omit<QueryRawRecordsQuery, 'limit'>): Promise<number> => {
  const params: QueryRawRecordsQuery = { ...query, limit: 1 }
  const response = await axios.get<QueryRawRecordsResponse>(`${API_URL}/raw-records`, {
    headers: { Authorization: `Bearer ${auth.value.token}` },
    params,
  })
  return response.data.total
}
