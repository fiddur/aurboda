import type {
  AddCheckInFormBody,
  CheckIn,
  CheckInAdherence,
  CheckInAdherenceResponse,
  CheckInForm,
  CheckInFormResponse,
  CheckInFormsResponse,
  CheckInResponse,
  CheckInsResponse,
  CheckInTemplate,
  CheckInTemplatesResponse,
  DueResponse,
  SubmitCheckInBody,
  UpdateCheckInBody,
  UpdateCheckInFormBody,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'
import { apiErrorMessage } from './feed'

const authHeaders = () => ({ Authorization: `Bearer ${auth.value.token}` })

const withMessage = async <T>(request: () => Promise<T>, fallback: string): Promise<T> => {
  try {
    return await request()
  } catch (error) {
    throw new Error(apiErrorMessage(error, fallback))
  }
}

const present = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`No ${what} in the answer`)
  return value
}

const formUrl = (id: string) => `${API_URL}/check-in-forms/${encodeURIComponent(id)}`
const checkInUrl = (id: string) => `${API_URL}/check-ins/${encodeURIComponent(id)}`

const SAVE_FORM = 'Couldn’t save the form. Please try again.'
const SAVE_CHECK_IN = 'Couldn’t save the check-in. Please try again.'

export const fetchCheckInForms = async (deleted = false): Promise<CheckInForm[]> => {
  const response = await axios.get<CheckInFormsResponse>(`${API_URL}/check-in-forms`, {
    headers: authHeaders(),
    params: deleted ? { deleted: true } : undefined,
  })
  return response.data.forms
}

export const fetchCheckInForm = async (id: string): Promise<CheckInForm> => {
  const response = await axios.get<CheckInFormResponse>(formUrl(id), { headers: authHeaders() })
  return present(response.data.form, 'form')
}

export const addCheckInForm = (body: AddCheckInFormBody): Promise<CheckInForm> =>
  withMessage(async () => {
    const response = await axios.post<CheckInFormResponse>(`${API_URL}/check-in-forms`, body, {
      headers: authHeaders(),
    })
    return present(response.data.form, 'form')
  }, SAVE_FORM)

export const updateCheckInForm = (id: string, body: UpdateCheckInFormBody): Promise<CheckInForm> =>
  withMessage(async () => {
    const response = await axios.patch<CheckInFormResponse>(formUrl(id), body, { headers: authHeaders() })
    return present(response.data.form, 'form')
  }, SAVE_FORM)

export const deleteCheckInForm = (id: string): Promise<void> =>
  withMessage(async () => {
    await axios.delete<CheckInFormResponse>(formUrl(id), { headers: authHeaders() })
  }, 'Couldn’t delete the form. Please try again.')

export const restoreCheckInForm = (id: string): Promise<CheckInForm> =>
  withMessage(async () => {
    const response = await axios.post<CheckInFormResponse>(`${formUrl(id)}/restore`, undefined, {
      headers: authHeaders(),
    })
    return present(response.data.form, 'form')
  }, 'Couldn’t restore the form. Please try again.')

export const fetchCheckInTemplates = async (): Promise<CheckInTemplate[]> => {
  const response = await axios.get<CheckInTemplatesResponse>(`${API_URL}/check-in-templates`, {
    headers: authHeaders(),
  })
  return response.data.templates
}

export interface CheckInsFilter {
  form_id?: string
  entity_type?: 'activity'
  entity_id?: string
  deleted?: boolean
  limit?: number
}

export const fetchCheckIns = async (filter: CheckInsFilter = {}): Promise<CheckInsResponse> => {
  const response = await axios.get<CheckInsResponse>(`${API_URL}/check-ins`, {
    headers: authHeaders(),
    params: filter,
  })
  return response.data
}

export const submitCheckIn = (body: SubmitCheckInBody): Promise<CheckIn> =>
  withMessage(async () => {
    const response = await axios.post<CheckInResponse>(`${API_URL}/check-ins`, body, {
      headers: authHeaders(),
    })
    return present(response.data.check_in, 'check-in')
  }, SAVE_CHECK_IN)

export const updateCheckIn = (id: string, body: UpdateCheckInBody): Promise<CheckIn> =>
  withMessage(async () => {
    const response = await axios.patch<CheckInResponse>(checkInUrl(id), body, { headers: authHeaders() })
    return present(response.data.check_in, 'check-in')
  }, SAVE_CHECK_IN)

export const deleteCheckIn = (id: string): Promise<void> =>
  withMessage(async () => {
    await axios.delete<CheckInResponse>(checkInUrl(id), { headers: authHeaders() })
  }, 'Couldn’t delete the check-in. Please try again.')

export const restoreCheckIn = (id: string): Promise<CheckIn> =>
  withMessage(async () => {
    const response = await axios.post<CheckInResponse>(`${checkInUrl(id)}/restore`, undefined, {
      headers: authHeaders(),
    })
    return present(response.data.check_in, 'check-in')
  }, 'Couldn’t restore the check-in. Please try again.')

export const fetchDue = async (): Promise<DueResponse> => {
  const response = await axios.get<DueResponse>(`${API_URL}/due`, { headers: authHeaders() })
  return response.data
}

export const fetchCheckInAdherence = async (formId: string): Promise<CheckInAdherence> => {
  const response = await axios.get<CheckInAdherenceResponse>(`${formUrl(formId)}/adherence`, {
    headers: authHeaders(),
  })
  return present(response.data.adherence, 'adherence')
}
