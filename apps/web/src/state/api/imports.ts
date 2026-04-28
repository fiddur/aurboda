import type { ImportJob } from '@aurboda/api-spec'

import axios from 'axios'

import { auth } from '../auth'

const API_URL = import.meta.env.VITE_API_URL || '/api'

export type { ImportJob }

// All import endpoints are admin-only; the central shared library is a
// server-wide resource.
export const listImportJobsApi = async (source?: string, limit = 10): Promise<ImportJob[]> => {
  const { token } = auth.value
  const response = await axios.get<{ data: ImportJob[]; success: boolean }>(`${API_URL}/admin/imports`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { limit, source },
  })
  return response.data.data ?? []
}

export const getImportJobApi = async (id: string): Promise<ImportJob | null> => {
  const { token } = auth.value
  const response = await axios.get<{ data?: ImportJob; success: boolean }>(`${API_URL}/admin/imports/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data.data ?? null
}

export const startLivsmedelsverketImportApi = async (): Promise<ImportJob> => {
  const { token } = auth.value
  const response = await axios.post<{ data: ImportJob; success: boolean }>(
    `${API_URL}/admin/imports/livsmedelsverket`,
    null,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!response.data.data) throw new Error('Failed to start import')
  return response.data.data
}
