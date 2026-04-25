import type { GoalProgress, GoalsProgressResponse } from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

// Fetch goal progress
export const fetchGoalsProgress = async (): Promise<GoalProgress[]> => {
  const { token } = auth.value
  const response = await axios.get<GoalsProgressResponse>(`${API_URL}/goals/progress`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.goals
}
