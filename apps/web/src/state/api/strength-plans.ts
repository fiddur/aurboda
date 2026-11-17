import type {
  CreateStrengthPlanBody,
  StrengthPlan,
  StrengthPlanResponse,
  StrengthPlansQuery,
  StrengthPlansResponse,
  UpdateStrengthPlanBody,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

const plansUrl = `${API_URL}/strength-plans`

const planUrl = (id: string): string => `${plansUrl}/${encodeURIComponent(id)}`

const authHeaders = () => ({ Authorization: `Bearer ${auth.value.token}` })

const planOf = (response: StrengthPlanResponse): StrengthPlan => {
  if (!response.data) throw new Error(response.error ?? 'No plan in the response')
  return response.data
}

export const fetchStrengthPlans = async (status?: StrengthPlansQuery['status']): Promise<StrengthPlan[]> => {
  const response = await axios.get<StrengthPlansResponse>(plansUrl, {
    headers: authHeaders(),
    params: status === undefined ? {} : { status },
  })
  return response.data.data ?? []
}

export const fetchStrengthPlan = async (id: string): Promise<StrengthPlan> => {
  const response = await axios.get<StrengthPlanResponse>(planUrl(id), { headers: authHeaders() })
  return planOf(response.data)
}

export const createStrengthPlan = async (body: CreateStrengthPlanBody): Promise<StrengthPlan> => {
  const response = await axios.post<StrengthPlanResponse>(plansUrl, body, { headers: authHeaders() })
  return planOf(response.data)
}

export const updateStrengthPlan = async (id: string, body: UpdateStrengthPlanBody): Promise<StrengthPlan> => {
  const response = await axios.patch<StrengthPlanResponse>(planUrl(id), body, { headers: authHeaders() })
  return planOf(response.data)
}

export const deleteStrengthPlan = async (id: string): Promise<void> => {
  await axios.delete(planUrl(id), { headers: authHeaders() })
}
