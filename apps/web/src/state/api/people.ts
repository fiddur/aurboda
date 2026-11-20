import type {
  AddPersonBody,
  AddPersonDateBody,
  ImportantDatesQuery,
  ImportantDatesResponse,
  PeopleResponse,
  Person,
  PersonDate,
  PersonDateResponse,
  PersonDetail,
  PersonDetailResponse,
  PersonPostsResponse,
  PersonResponse,
  TimelineEntry,
  UpdatePersonBody,
  UpdatePersonDateBody,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'
import { apiErrorMessage } from './feed'

const authHeaders = () => ({ Authorization: `Bearer ${auth.value.token}` })

const withMessage = async <T>(request: () => Promise<T>, fallback: string): Promise<T> => {
  try {
    return await request()
  } catch (error) {
    throw new Error(apiErrorMessage(error, fallback))
  }
}

const personUrl = (id: string) => `${API_URL}/people/${encodeURIComponent(id)}`

export const PEOPLE_KEY = ['people'] as const

export const fetchPeople = async (
  options: { archived?: boolean; deleted?: boolean } = {},
): Promise<PeopleResponse> => {
  const params = {
    ...(options.archived ? { archived: 'true' } : {}),
    ...(options.deleted ? { deleted: 'true' } : {}),
  }
  const response = await axios.get<PeopleResponse>(`${API_URL}/people`, { headers: authHeaders(), params })
  return response.data
}

export const fetchPerson = async (id: string): Promise<PersonDetail | undefined> => {
  const response = await axios.get<PersonDetailResponse>(personUrl(id), { headers: authHeaders() })
  return response.data.person
}

export const addPerson = (body: AddPersonBody): Promise<Person | undefined> =>
  withMessage(async () => {
    const response = await axios.post<PersonResponse>(`${API_URL}/people`, body, { headers: authHeaders() })
    return response.data.person
  }, 'Couldn’t add the person. Please try again.')

export const updatePerson = (id: string, body: UpdatePersonBody): Promise<Person | undefined> =>
  withMessage(async () => {
    const response = await axios.patch<PersonResponse>(personUrl(id), body, { headers: authHeaders() })
    return response.data.person
  }, 'Couldn’t save. Please try again.')

export const deletePerson = (id: string, options: { purge?: boolean } = {}): Promise<void> =>
  withMessage(async () => {
    await axios.delete(personUrl(id), {
      headers: authHeaders(),
      params: options.purge ? { purge: 'true' } : {},
    })
  }, 'Couldn’t delete. Please try again.')

export const restorePerson = (id: string): Promise<Person | undefined> =>
  withMessage(async () => {
    const response = await axios.post<PersonResponse>(
      `${personUrl(id)}/restore`,
      {},
      { headers: authHeaders() },
    )
    return response.data.person
  }, 'Couldn’t restore. Please try again.')

export const fetchPersonPosts = async (id: string, limit?: number): Promise<TimelineEntry[]> => {
  const response = await axios.get<PersonPostsResponse>(`${personUrl(id)}/posts`, {
    headers: authHeaders(),
    params: limit ? { limit } : {},
  })
  return response.data.entries ?? []
}

export const addPersonDate = (personId: string, body: AddPersonDateBody): Promise<PersonDate | undefined> =>
  withMessage(async () => {
    const response = await axios.post<PersonDateResponse>(`${personUrl(personId)}/dates`, body, {
      headers: authHeaders(),
    })
    return response.data.date
  }, 'Couldn’t save the date. Please try again.')

export const updatePersonDate = (
  personId: string,
  dateId: string,
  body: UpdatePersonDateBody,
): Promise<PersonDate | undefined> =>
  withMessage(async () => {
    const response = await axios.patch<PersonDateResponse>(
      `${personUrl(personId)}/dates/${encodeURIComponent(dateId)}`,
      body,
      { headers: authHeaders() },
    )
    return response.data.date
  }, 'Couldn’t save the date. Please try again.')

export const deletePersonDate = (personId: string, dateId: string): Promise<void> =>
  withMessage(async () => {
    await axios.delete(`${personUrl(personId)}/dates/${encodeURIComponent(dateId)}`, {
      headers: authHeaders(),
    })
  }, 'Couldn’t delete the date. Please try again.')

export const fetchImportantDates = async (
  query: ImportantDatesQuery = {},
): Promise<ImportantDatesResponse> => {
  const response = await axios.get<ImportantDatesResponse>(`${API_URL}/people/dates`, {
    headers: authHeaders(),
    params: query,
  })
  return response.data
}
