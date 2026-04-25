import type {
  AddReportBody,
  Report as ApiReport,
  ReportResponse,
  ReportsResponse,
  UpdateReportBody,
} from '@aurboda/api-spec'

import axios from 'axios'

import type { Report } from './types'

import { API_URL } from '../../config'
import { auth } from '../auth'

const mapReport = (r: ApiReport): Report => ({
  ...r,
  created_at: r.created_at ? new Date(r.created_at) : undefined,
  date: new Date(r.date),
})

export const fetchReports = async (params?: {
  report_type?: string
  start?: string
  end?: string
}): Promise<Report[]> => {
  const { token } = auth.value
  const response = await axios.get<ReportsResponse>(`${API_URL}/reports`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })
  return (response.data.data ?? []).map(mapReport)
}

export const fetchReport = async (id: string): Promise<Report> => {
  const { token } = auth.value
  const response = await axios.get<ReportResponse>(`${API_URL}/reports/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return mapReport(response.data.data!)
}

export const createReport = async (body: AddReportBody): Promise<Report> => {
  const { token } = auth.value
  const response = await axios.post<ReportResponse>(`${API_URL}/reports`, body, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return mapReport(response.data.data!)
}

export const updateReport = async (id: string, body: UpdateReportBody): Promise<Report> => {
  const { token } = auth.value
  const response = await axios.patch<ReportResponse>(`${API_URL}/reports/${id}`, body, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return mapReport(response.data.data!)
}

export const deleteReport = async (id: string): Promise<void> => {
  const { token } = auth.value
  await axios.delete(`${API_URL}/reports/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}
