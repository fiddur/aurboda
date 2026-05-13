import type { AuditLogResponse } from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

export interface FetchAuditLogParams {
  level?: string
  category?: string
  since?: string
  limit?: number
  offset?: number
}

export const fetchAuditLog = async (params: FetchAuditLogParams = {}): Promise<AuditLogResponse> => {
  const { token } = auth.value
  const response = await axios.get<AuditLogResponse>(`${API_URL}/user/audit-log`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })
  return response.data
}
