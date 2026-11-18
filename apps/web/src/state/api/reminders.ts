import type {
  AddReminderBody,
  BaseResponse,
  Reminder,
  ReminderResponse,
  RemindersResponse,
  UpdateReminderBody,
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

export const fetchReminders = async (): Promise<RemindersResponse> => {
  const response = await axios.get<RemindersResponse>(`${API_URL}/reminders`, { headers: authHeaders() })
  return response.data
}

export const addReminder = (body: AddReminderBody): Promise<Reminder | undefined> =>
  withMessage(async () => {
    const response = await axios.post<ReminderResponse>(`${API_URL}/reminders`, body, {
      headers: authHeaders(),
    })
    return response.data.reminder
  }, 'Couldn’t save the reminder. Please try again.')

export const updateReminder = (id: string, body: UpdateReminderBody): Promise<Reminder | undefined> =>
  withMessage(async () => {
    const response = await axios.patch<ReminderResponse>(
      `${API_URL}/reminders/${encodeURIComponent(id)}`,
      body,
      { headers: authHeaders() },
    )
    return response.data.reminder
  }, 'Couldn’t save the reminder. Please try again.')

export const deleteReminder = (id: string): Promise<void> =>
  withMessage(async () => {
    await axios.delete<BaseResponse>(`${API_URL}/reminders/${encodeURIComponent(id)}`, {
      headers: authHeaders(),
    })
  }, 'Couldn’t delete the reminder. Please try again.')
