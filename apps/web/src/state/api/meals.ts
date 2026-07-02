import type {
  AddFoodItemBody,
  AddFoodItemPortionBody,
  AddMealBody,
  FoodItemDetail as ApiFoodItemDetail,
  Meal as ApiMeal,
  FoodItemDetailResponse,
  FoodItemPortion,
  FoodItemPortionResponse,
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
  UpdateFoodItemPortionBody,
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

export const addFoodItemApi = async (body: AddFoodItemBody): Promise<FoodItemEntity> => {
  const { token } = auth.value
  // Use the local FoodItemEntity shape on the response (matches the pattern
  // in searchFoodItemsApi) — the api-spec FoodItemResponse has a boolean
  // `is_composite` field that doesn't fit the local entity's index signature.
  const response = await axios.post<{ data?: FoodItemEntity; error?: string; success: boolean }>(
    `${API_URL}/food-items`,
    body,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!response.data.data) throw new Error(response.data.error ?? 'Failed to create food item')
  return response.data.data
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

export const fetchFoodItemDetailApi = async (id: string): Promise<ApiFoodItemDetail> => {
  const { token } = auth.value
  const response = await axios.get<FoodItemDetailResponse>(`${API_URL}/food-items/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.data.data) throw new Error(response.data.error ?? 'Food item not found')
  return response.data.data
}

export const duplicateFoodItemApi = async (id: string): Promise<ApiFoodItemDetail> => {
  const { token } = auth.value
  const response = await axios.post<FoodItemDetailResponse>(`${API_URL}/food-items/${id}/duplicate`, null, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.data.data) throw new Error(response.data.error ?? 'Duplicate failed')
  return response.data.data
}

// ─── Food item portions ─────────────────────────────────────────────────────

export const addFoodItemPortionApi = async (
  foodItemId: string,
  body: AddFoodItemPortionBody,
): Promise<FoodItemPortion> => {
  const { token } = auth.value
  const response = await axios.post<FoodItemPortionResponse>(
    `${API_URL}/food-items/${foodItemId}/portions`,
    body,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!response.data.data) throw new Error(response.data.error ?? 'Failed to add portion')
  return response.data.data
}

export const updateFoodItemPortionApi = async (
  foodItemId: string,
  portionId: string,
  body: UpdateFoodItemPortionBody,
): Promise<FoodItemPortion> => {
  const { token } = auth.value
  const response = await axios.patch<FoodItemPortionResponse>(
    `${API_URL}/food-items/${foodItemId}/portions/${portionId}`,
    body,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!response.data.data) throw new Error(response.data.error ?? 'Failed to update portion')
  return response.data.data
}

export const deleteFoodItemPortionApi = async (foodItemId: string, portionId: string): Promise<void> => {
  const { token } = auth.value
  await axios.delete(`${API_URL}/food-items/${foodItemId}/portions/${portionId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export const setDefaultPortionApi = async (
  foodItemId: string,
  portionId: string | null,
  quantity: number | null = null,
): Promise<void> => {
  const { token } = auth.value
  await axios.put(
    `${API_URL}/food-items/${foodItemId}/default-portion`,
    { portion_id: portionId, quantity },
    { headers: { Authorization: `Bearer ${token}` } },
  )
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
