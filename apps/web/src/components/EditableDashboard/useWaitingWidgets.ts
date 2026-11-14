import type { DashboardConfig, DashboardSection } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'preact/hooks'

import { fetchDataPresence } from '../../state/api'
import { dashboardSources, visibleSections, waitingWidgetIds } from './dataPresence'

const none: ReadonlySet<string> = new Set()

/** Ids of the widgets whose sources have never delivered; none while `enabled` is false or the answer is pending. */
export const useWaitingWidgets = (config: DashboardConfig, enabled: boolean): ReadonlySet<string> => {
  const sources = useMemo(() => dashboardSources(config), [config])
  const { data } = useQuery({
    enabled: enabled && sources.metrics.length + sources.activity_types.length > 0,
    queryFn: () => fetchDataPresence(sources.metrics, sources.activity_types),
    queryKey: ['dataPresence', sources.metrics.join(','), sources.activity_types.join(',')],
    staleTime: 5 * 60 * 1000,
  })
  return useMemo(() => (enabled && data ? waitingWidgetIds(config, data) : none), [enabled, data, config])
}

/** The sections to draw: with `hide`, without the widgets still waiting for data, and how many those are. */
export const useVisibleSections = (
  config: DashboardConfig,
  hide: boolean,
): { sections: DashboardSection[]; waitingCount: number } => {
  const waiting = useWaitingWidgets(config, hide)
  return useMemo(
    () => ({ sections: visibleSections(config.sections, waiting), waitingCount: waiting.size }),
    [config.sections, waiting],
  )
}
