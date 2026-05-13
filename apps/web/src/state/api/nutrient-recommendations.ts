import type {
  NutrientPeriodSummary,
  NutrientPeriodSummaryQuery,
  NutrientPeriodSummaryResponse,
  NutrientRecommendation,
  NutrientRecommendationResponse,
  NutrientRecommendationsResponse,
  UpsertNutrientRecommendationBody,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

const headers = () => ({ Authorization: `Bearer ${auth.value.token}` })

export const fetchNutrientRecommendations = async (): Promise<NutrientRecommendation[]> => {
  const res = await axios.get<NutrientRecommendationsResponse>(`${API_URL}/nutrient-recommendations`, {
    headers: headers(),
  })
  return res.data.recommendations ?? []
}

export const setNutrientRecommendation = async (
  nutrientName: string,
  body: UpsertNutrientRecommendationBody,
): Promise<NutrientRecommendation | undefined> => {
  const res = await axios.put<NutrientRecommendationResponse>(
    `${API_URL}/nutrient-recommendations/${encodeURIComponent(nutrientName)}`,
    body,
    { headers: headers() },
  )
  return res.data.data
}

export const clearNutrientRecommendation = async (
  nutrientName: string,
): Promise<NutrientRecommendation | undefined> => {
  const res = await axios.delete<NutrientRecommendationResponse>(
    `${API_URL}/nutrient-recommendations/${encodeURIComponent(nutrientName)}`,
    { headers: headers() },
  )
  return res.data.data
}

export const fetchMealsPeriodSummary = async (
  params: NutrientPeriodSummaryQuery,
): Promise<NutrientPeriodSummary | undefined> => {
  const res = await axios.get<NutrientPeriodSummaryResponse>(`${API_URL}/meals/period-summary`, {
    headers: headers(),
    params,
  })
  return res.data.data
}
