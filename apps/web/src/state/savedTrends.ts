import { signal } from '@preact/signals'
import type { FetchTrendParams } from './api'

export interface SavedTrend {
  id: string
  name: string
  params: FetchTrendParams
}

// Default trends shown when no saved trends exist
export const DEFAULT_TRENDS: SavedTrend[] = [
  {
    id: 'preset-painkillers',
    name: 'Painkillers',
    params: {
      display_period: 'monthly',
      half_life_days: 15,
      lookback_days: 180,
      pattern: 'pain_killer|painkiller|ibuprofen',
      source_type: 'tag',
    },
  },
  {
    id: 'preset-coffee',
    name: 'Coffee',
    params: {
      display_period: 'daily',
      half_life_days: 7,
      lookback_days: 90,
      pattern: 'coffee',
      source_type: 'tag',
    },
  },
  {
    id: 'preset-weight',
    name: 'Weight',
    params: {
      aggregation: 'mean',
      display_period: 'daily',
      half_life_days: 14,
      lookback_days: 180,
      pattern: 'weight',
      source_type: 'metric',
    },
  },
]

const STORAGE_KEY = 'savedTrends'

const loadSavedTrends = (): SavedTrend[] => {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) {
    try {
      return JSON.parse(saved) as SavedTrend[]
    } catch {
      return DEFAULT_TRENDS
    }
  }
  return DEFAULT_TRENDS
}

export const savedTrends = signal<SavedTrend[]>(loadSavedTrends())

savedTrends.subscribe((value) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
})

export const generateTrendId = (): string => `trend-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

export const addSavedTrend = (name: string, params: FetchTrendParams): void => {
  const newTrend: SavedTrend = {
    id: generateTrendId(),
    name,
    params,
  }
  savedTrends.value = [...savedTrends.value, newTrend]
}

export const updateSavedTrend = (id: string, name: string, params: FetchTrendParams): void => {
  savedTrends.value = savedTrends.value.map((t) => (t.id === id ? { ...t, name, params } : t))
}

export const removeSavedTrend = (id: string): void => {
  savedTrends.value = savedTrends.value.filter((t) => t.id !== id)
}

export const resetToDefaults = (): void => {
  savedTrends.value = DEFAULT_TRENDS
}
