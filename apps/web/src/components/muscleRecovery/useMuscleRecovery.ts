import { useQuery } from '@tanstack/react-query'

import { fetchMuscleRecovery } from '../../state/api'

export const useMuscleRecovery = (name: string, field: string) =>
  useQuery({
    queryFn: () => fetchMuscleRecovery(name, field),
    queryKey: ['muscle-recovery', name, field],
    staleTime: 5 * 60 * 1000,
  })
