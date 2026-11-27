import type { UserSettingsResponse } from '@aurboda/api-spec'
import type { QueryClient } from '@tanstack/react-query'

/** The overview refetch is not awaited: a save reads as saved once the settings are current. */
export const invalidateSourceQueries = async (
  queryClient: QueryClient,
  savedSettings?: UserSettingsResponse,
): Promise<void> => {
  void queryClient.invalidateQueries({ queryKey: ['dataSourcesOverview'] })
  if (savedSettings) queryClient.setQueryData(['userSettings'], savedSettings)
  else await queryClient.invalidateQueries({ queryKey: ['userSettings'] })
}
