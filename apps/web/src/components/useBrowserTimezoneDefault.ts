import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'preact/hooks'

import { fetchUserSettings, updateUserSettings } from '../state/api'
import { auth } from '../state/auth'
import { browserTimezone, createTimezoneAdopter } from '../utils/browserTimezone'

const adopt = createTimezoneAdopter()

/** Gives a signed-in user without a stored time zone the browser's, silently. */
export const useBrowserTimezoneDefault = () => {
  const queryClient = useQueryClient()
  const { token, user } = auth.value
  const { data } = useQuery({
    enabled: !!token,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
    staleTime: 5 * 60 * 1000,
  })
  const storedTz = data?.tz

  useEffect(() => {
    if (!token || !user) return
    void adopt({
      browserTz: browserTimezone(),
      onSaved: (settings) => queryClient.setQueryData(['userSettings'], settings),
      save: updateUserSettings,
      storedTz,
      user,
    })
  }, [token, user, storedTz, queryClient])
}
