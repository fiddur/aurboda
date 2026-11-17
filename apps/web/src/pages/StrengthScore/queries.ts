import { useQuery } from '@tanstack/react-query'

import { fetchStrengthScore } from '../../state/api'

export const useStrengthScore = (name: string, field: string) =>
  useQuery({
    queryFn: () => fetchStrengthScore(name, field),
    queryKey: ['strength-score', name, field],
    staleTime: 5 * 60 * 1000,
  })
