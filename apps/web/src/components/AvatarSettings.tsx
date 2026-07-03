import { useMutation } from '@tanstack/react-query'
import axios from 'axios'
import { useState } from 'preact/hooks'

import { avatarUrl, deleteAvatar, uploadAvatar } from '../state/api/profile'
import { auth } from '../state/auth'
import { SettingsSection } from './SettingsSection'

/** Prefer the backend's descriptive `{ error }` over axios's generic message. */
const errorMessage = (err: unknown, fallback: string): string => {
  if (axios.isAxiosError(err)) {
    const data: unknown = err.response?.data
    if (typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string') {
      return data.error
    }
    return err.message
  }
  return err instanceof Error ? err.message : fallback
}

export function AvatarSettings() {
  const username = auth.value.user
  // Bumped after upload/remove to bust the browser (and CDN) avatar cache.
  const [cacheBust, setCacheBust] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const uploadMut = useMutation({
    mutationFn: (file: File) => uploadAvatar(file),
    onError: (err) => setError(errorMessage(err, 'Upload failed')),
    onSuccess: () => {
      setError(null)
      setCacheBust(Date.now())
    },
  })

  const deleteMut = useMutation({
    mutationFn: () => deleteAvatar(),
    onError: (err) => setError(errorMessage(err, 'Remove failed')),
    onSuccess: () => {
      setError(null)
      setCacheBust(Date.now())
    },
  })

  if (!username) return null

  const src = `${avatarUrl(username)}${cacheBust ? `?t=${cacheBust}` : ''}`

  const onFileChange = (e: Event) => {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (file) uploadMut.mutate(file)
    // Reset so re-picking the same file (e.g. retry after a failure) re-fires onChange.
    input.value = ''
  }

  return (
    <SettingsSection
      title="Avatar"
      description="Shown on your public profile, shared-page link previews, and federated posts. If you don't set one, a generated identicon is used."
    >
      <div class="avatar-settings">
        <img class="avatar-settings__preview" src={src} alt="Your avatar" width={96} height={96} />
        <div class="avatar-settings__actions">
          <label class="avatar-settings__upload">
            {uploadMut.isPending ? 'Uploading…' : 'Upload image'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={onFileChange}
              disabled={uploadMut.isPending}
            />
          </label>
          <button type="button" onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending}>
            Remove
          </button>
        </div>
      </div>
      {error && <p class="avatar-settings__error">{error}</p>}
    </SettingsSection>
  )
}
