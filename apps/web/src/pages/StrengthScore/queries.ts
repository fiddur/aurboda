import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo } from 'preact/hooks'

import { fetchStrengthScore, fetchStrengthScoreHistory } from '../../state/api'
import { strengthScorePeriod } from './strengthScoreView'

const FIVE_MIN = 5 * 60 * 1000

export const useStrengthScore = (name: string, field: string) =>
  useQuery({
    queryFn: () => fetchStrengthScore(name, field),
    queryKey: ['strength-score', name, field],
    staleTime: FIVE_MIN,
  })

export const useStrengthScoreHistory = (name: string, field: string, days: number) => {
  const period = useMemo(() => strengthScorePeriod(days, new Date()), [days])
  return useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchStrengthScoreHistory(name, { field, ...period }),
    queryKey: ['strength-score-history', name, field, period.start, period.end, period.step_days],
    staleTime: FIVE_MIN,
  })
}
