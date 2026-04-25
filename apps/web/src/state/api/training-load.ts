import type { TrainingLoadResponse, TrainingLoadResult } from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'
import { browserTz } from './client'

export const fetchTrainingLoad = async (
  start: Date,
  end: Date,
  bucketSize?: '1h' | '1d' | '1w',
): Promise<TrainingLoadResult> => {
  const { token } = auth.value
  const response = await axios.get<TrainingLoadResponse>(`${API_URL}/training-load`, {
    headers: { Authorization: `Bearer ${token}` },
    params: {
      bucket_size: bucketSize,
      end: end.toISOString(),
      start: start.toISOString(),
      tz: browserTz,
    },
  })
  return response.data.data!
}
