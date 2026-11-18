import type { UserSettingsResponse } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { fetchUserSettings, updateUserSettings } from '../state/api'
import { auth } from '../state/auth'

const SETTINGS_KEY = ['userSettings'] as const
const NOTHING_HIDDEN: readonly string[] = []

/** The user's hidden menu paths; empty while the settings load or when they fail, so the full menu shows. */
export const useHiddenPages = (): readonly string[] => {
  const { data } = useQuery({
    enabled: !!auth.value.token,
    queryFn: fetchUserSettings,
    queryKey: SETTINGS_KEY,
    staleTime: 5 * 60 * 1000,
  })
  return data?.hidden_pages ?? NOTHING_HIDDEN
}

/**
 * Saves the whole hidden list, showing it at once. The cache is updated before the save is queued,
 * not in `onMutate`, because scoped saves run one at a time and a toggle made while one is queued
 * must build on the list it will send. The shared scope keeps them in order: each sends a full list,
 * and an older list arriving last would undo the newer one.
 */
export const useSetHiddenPages = (handlers: { onError?: (err: unknown) => void; onSaved?: () => void }) => {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (hidden: string[]) => updateUserSettings({ hidden_pages: hidden }),
    onError: (err) => {
      handlers.onError?.(err)
      void queryClient.invalidateQueries({ queryKey: SETTINGS_KEY })
    },
    onSuccess: () => handlers.onSaved?.(),
    scope: { id: 'hidden-pages' },
  })
  return (hidden: string[]) => {
    queryClient.setQueryData<UserSettingsResponse>(SETTINGS_KEY, (current) =>
      current ? { ...current, hidden_pages: hidden } : current,
    )
    mutation.mutate(hidden)
  }
}
