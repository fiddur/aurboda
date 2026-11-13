import type {
  ExerciseCatalogEntry,
  ExerciseCatalogQuery,
  ExerciseCatalogSearchResponse,
  ExerciseCatalogSearchResult,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

export const searchExerciseCatalog = async (
  query: Partial<ExerciseCatalogQuery>,
): Promise<ExerciseCatalogSearchResult> => {
  const response = await axios.get<ExerciseCatalogSearchResponse>(`${API_URL}/exercise-catalog`, {
    headers: { Authorization: `Bearer ${auth.value.token}` },
    params: query,
  })
  return response.data.data ?? { entries: [], total: 0, version: '' }
}

export const fetchExerciseByName = async (name: string): Promise<ExerciseCatalogEntry | null> => {
  const result = await searchExerciseCatalog({ limit: 1, name })
  return result.entries[0] ?? null
}
