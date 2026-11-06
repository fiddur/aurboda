import type { AccountPlanResponse } from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

export const fetchMyPlan = async (): Promise<AccountPlanResponse> => {
  const { token } = auth.value
  const response = await axios.get<AccountPlanResponse>(`${API_URL}/account/plan`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}
