import axios from 'axios'

export const RESYNC_FALLBACK_ERROR = 'Re-sync failed'

/** The server's reason when the answer carries one, else the error's own message. */
export const resyncErrorText = (error: unknown): string => {
  if (axios.isAxiosError<{ error?: string }>(error) && error.response?.data?.error) {
    return error.response.data.error
  }
  return error instanceof Error ? error.message : RESYNC_FALLBACK_ERROR
}
