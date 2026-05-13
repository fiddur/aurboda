import type {
  AddMealBody,
  Meal as ApiMeal,
  FrequentFoodItem,
  FrequentFoodItemsResponse,
  FrequentMeal,
  FrequentMealsResponse,
  MealResponse,
  MealsQuery,
  MealsResponse,
  MergeFoodItemsBody,
  MergeFoodItemsPreview,
  MergeFoodItemsPreviewResponse,
  MergeFoodItemsResponse,
  MergeFoodItemsResult,
  UpdateMealBody,
} from '@aurboda/api-spec'

import axios from 'axios'

import type { Meal } from './types'

import { API_URL } from '../../config'
import { auth } from '../auth'

const mapMeal = (m: ApiMeal): Meal => ({
  ...m,
  created_at: m.created_at ? new Date(m.created_at) : undefined,
  time: new Date(m.time),
})

export interface MealsResult {
  meals: Meal[]
  log_completed?: boolean
}

export const fetchMeals = async (params?: MealsQuery): Promise<MealsResult> => {
  const { token } = auth.value
  const response = await axios.get<MealsResponse>(`${API_URL}/meals`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })
  return {
    meals: (response.data.data ?? []).map(mapMeal),
    log_completed: response.data.log_completed,
  }
}

export const fetchMeal = async (id: string): Promise<Meal> => {
  const { token } = auth.value
  const response = await axios.get<MealResponse>(`${API_URL}/meals/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return mapMeal(response.data.data!)
}

export const addMealApi = async (body: AddMealBody): Promise<Meal> => {
  const { token } = auth.value
  const payload = { ...body, id: body.id ?? crypto.randomUUID() }
  const response = await axios.put<MealResponse>(`${API_URL}/meals`, payload, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return mapMeal(response.data.data!)
}

export const updateMealApi = async (id: string, body: UpdateMealBody): Promise<Meal> => {
  const { token } = auth.value
  const response = await axios.patch<MealResponse>(`${API_URL}/meals/${id}`, body, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return mapMeal(response.data.data!)
}

export const deleteMealApi = async (id: string): Promise<void> => {
  const { token } = auth.value
  await axios.delete(`${API_URL}/meals/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Meal log completion

export const setMealLogCompletedApi = async (date: string): Promise<void> => {
  const { token } = auth.value
  await axios.put(`${API_URL}/meals/log-completed/${date}`, null, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export const unsetMealLogCompletedApi = async (date: string): Promise<void> => {
  const { token } = auth.value
  await axios.delete(`${API_URL}/meals/log-completed/${date}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export interface FoodItemEntity {
  id: string
  name: string
  source?: string
  default_quantity?: number
  default_unit?: string
  icon?: string
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  fiber?: number
  [nutrient: string]: string | number | undefined
}

export const fetchFrequentMealsApi = async (
  meal_type: string,
  limit = 6,
  since_days = 90,
): Promise<FrequentMeal[]> => {
  const { token } = auth.value
  const response = await axios.get<FrequentMealsResponse>(`${API_URL}/meals/frequent`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { meal_type, limit, since_days },
  })
  return response.data.data ?? []
}

export const fetchFrequentFoodItemsApi = async (
  opts: { meal_type?: string; limit?: number; since_days?: number } = {},
): Promise<FrequentFoodItem[]> => {
  const { token } = auth.value
  const response = await axios.get<FrequentFoodItemsResponse>(`${API_URL}/meals/frequent-food-items`, {
    headers: { Authorization: `Bearer ${token}` },
    params: opts,
  })
  return response.data.data ?? []
}

export const searchFoodItemsApi = async (q: string, limit = 10): Promise<FoodItemEntity[]> => {
  const { token } = auth.value
  const response = await axios.get<{ data: FoodItemEntity[]; success: boolean }>(`${API_URL}/food-items`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { q, limit },
  })
  return response.data.data ?? []
}

export type { MergeFoodItemsPreview, MergeFoodItemsResult }

export const previewMergeFoodItemsApi = async (
  targetId: string,
  sourceId: string,
): Promise<MergeFoodItemsPreview> => {
  const { token } = auth.value
  const response = await axios.get<MergeFoodItemsPreviewResponse>(
    `${API_URL}/food-items/${targetId}/merge-preview`,
    {
      headers: { Authorization: `Bearer ${token}` },
      params: { source_id: sourceId },
    },
  )
  if (!response.data.data) throw new Error(response.data.error ?? 'Preview failed')
  return response.data.data
}

export const mergeFoodItemsApi = async (
  targetId: string,
  body: MergeFoodItemsBody,
): Promise<MergeFoodItemsResult> => {
  const { token } = auth.value
  const response = await axios.post<MergeFoodItemsResponse>(`${API_URL}/food-items/${targetId}/merge`, body, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.data.data) throw new Error(response.data.error ?? 'Merge failed')
  return response.data.data
}
