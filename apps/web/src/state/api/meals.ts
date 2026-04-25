import type {
  AddMealBody,
  Meal as ApiMeal,
  MealResponse,
  MealsQuery,
  MealsResponse,
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

export const searchFoodItemsApi = async (q: string, limit = 10): Promise<FoodItemEntity[]> => {
  const { token } = auth.value
  const response = await axios.get<{ data: FoodItemEntity[]; success: boolean }>(`${API_URL}/food-items`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { q, limit },
  })
  return response.data.data ?? []
}
