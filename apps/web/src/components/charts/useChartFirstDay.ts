import { useQuery } from '@tanstack/react-query'

import { type ChartFirstDayParams, fetchChartFirstDay } from '../../state/api'

/** The first day with data of an all-time chart's source; `pending` while it is being read. Nothing when not `enabled`. */
export const useChartFirstDay = (
  source: ChartFirstDayParams,
  enabled: boolean,
): { firstDay: string | undefined; pending: boolean } => {
  const query = useQuery({
    enabled,
    queryFn: () => fetchChartFirstDay(source),
    queryKey: ['chart-first-day', source],
    staleTime: 5 * 60 * 1000,
  })
  return { firstDay: enabled ? query.data?.first_day : undefined, pending: enabled && query.isLoading }
}
