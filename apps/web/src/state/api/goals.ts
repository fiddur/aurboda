import type {
  GoalHistoryQuery,
  GoalHistoryResponse,
  GoalProgress,
  GoalsProgressResponse,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

export const fetchGoalsProgress = async (): Promise<GoalProgress[]> => {
  const { token } = auth.value
  const response = await axios.get<GoalsProgressResponse>(`${API_URL}/goals/progress`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.goals
}

export const fetchGoalHistory = async (id: string, query: GoalHistoryQuery): Promise<GoalHistoryResponse> => {
  const { token } = auth.value
  const response = await axios.get<GoalHistoryResponse>(
    `${API_URL}/goals/${encodeURIComponent(id)}/history`,
    {
      headers: { Authorization: `Bearer ${token}` },
      params: query,
    },
  )

  return response.data
}
