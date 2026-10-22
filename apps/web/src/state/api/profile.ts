import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'
import { buildAvatarUrl } from './avatarUrl'

export { buildAvatarUrl } from './avatarUrl'

/**
 * Public URL of a user's avatar (their uploaded image, or a generated
 * identicon), resolved against the API origin.
 */
export const avatarUrl = (username: string): string =>
  buildAvatarUrl(username, API_URL, window.location.origin)

export interface AvatarUploadResult {
  success: boolean
  url?: string
  error?: string
}

export const uploadAvatar = async (file: File): Promise<AvatarUploadResult> => {
  const { token } = auth.value
  const formData = new FormData()
  formData.append('avatar', file)
  const { data } = await axios.post<AvatarUploadResult>(`${API_URL}/profile/avatar`, formData, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return data
}

export const deleteAvatar = async (): Promise<void> => {
  const { token } = auth.value
  await axios.delete(`${API_URL}/profile/avatar`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}
