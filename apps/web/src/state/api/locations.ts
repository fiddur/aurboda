import type {
  AddNamedLocationBody,
  AddNamedLocationResponse,
  DetectedLocation as ApiDetectedLocation,
  LocationsQuery,
  LocationsResponse,
  NamedLocation,
  NamedLocationsResponse,
  PromoteDetectedLocationBody,
  RawLocationsResponse,
  UpdateNamedLocationBody,
} from '@aurboda/api-spec'

import axios from 'axios'

import type { Place, PlaceVisit, StoredDetectedLocation } from './types'

import { API_URL } from '../../config'
import { auth } from '../auth'

export const fetchPlaces = async (start: Date, end: Date): Promise<Place[]> => {
  const { token } = auth.value
  const params: LocationsQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<LocationsResponse>(`${API_URL}/locations`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map((place) => ({
    ...place,
    end_time: new Date(place.end_time),
    region: place.name,
    start_time: new Date(place.start_time),
  }))
}

export const fetchPlaceVisits = async (start: Date, end: Date): Promise<PlaceVisit[]> => {
  const { token } = auth.value
  const params: LocationsQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<LocationsResponse>(`${API_URL}/locations`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map((place) => ({
    ...place,
    durationMinutes: place.duration,
    end_time: new Date(place.end_time),
    start_time: new Date(place.start_time),
  }))
}

export const fetchRawLocations = async (
  start: Date,
  end: Date,
): Promise<{ lat: number; lon: number; time: Date }[]> => {
  const { token } = auth.value
  const params: LocationsQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<RawLocationsResponse>(`${API_URL}/locations/raw`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map((point) => ({
    ...point,
    time: new Date(point.time),
  }))
}

export const fetchStoredDetectedLocations = async (): Promise<StoredDetectedLocation[]> => {
  const { token } = auth.value
  const response = await axios.get<{ success: boolean; data: ApiDetectedLocation[] }>(
    `${API_URL}/locations/detected/stored`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  )

  return response.data.data.map((loc) => ({
    ...loc,
    first_visit: new Date(loc.first_visit),
    last_visit: new Date(loc.last_visit),
  }))
}

export const fetchNamedLocations = async (): Promise<NamedLocation[]> => {
  const { token } = auth.value
  const response = await axios.get<NamedLocationsResponse>(`${API_URL}/locations/named`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.data ?? []
}

export const promoteDetectedLocation = async (
  params: PromoteDetectedLocationBody,
): Promise<NamedLocation> => {
  const { token } = auth.value
  const response = await axios.post<AddNamedLocationResponse>(
    `${API_URL}/locations/detected/promote`,
    params,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  )

  return response.data.data!
}

export const addNamedLocation = async (params: AddNamedLocationBody): Promise<NamedLocation> => {
  const { token } = auth.value
  const response = await axios.post<AddNamedLocationResponse>(`${API_URL}/locations/named`, params, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.data!
}

export const updateNamedLocation = async (
  id: string,
  params: UpdateNamedLocationBody,
): Promise<NamedLocation> => {
  const { token } = auth.value
  const response = await axios.patch<AddNamedLocationResponse>(`${API_URL}/locations/named/${id}`, params, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.data!
}
