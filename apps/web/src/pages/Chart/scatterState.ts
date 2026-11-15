import { parseScatterY, type ScatterY } from '../../components/charts/session-scatter'

export interface ScatterState {
  collapse: boolean
  group_by: string
  scatter_y: ScatterY
}

/** The sessions scatter's own URL parameters; `collapse` only applies with a field to collapse by. */
export const parseScatterQuery = (
  query: Partial<Record<'collapse' | 'group_by' | 'y', string>>,
): ScatterState => {
  const group_by = query.group_by ?? ''
  return {
    collapse: Boolean(group_by) && query.collapse === '1',
    group_by,
    scatter_y: parseScatterY(query.y),
  }
}

/** The scatter is a chart of an activity type's sessions: any other source falls back to the default chart. */
export const scatterAllowed = (query: Partial<Record<'chart_type' | 'source_type', string>>): boolean =>
  query.chart_type === 'scatter' && query.source_type !== 'metric'

export const scatterParams = (state: ScatterState): Record<string, string> => ({
  y: state.scatter_y,
  ...(state.group_by ? { group_by: state.group_by } : {}),
  ...(state.group_by && state.collapse ? { collapse: '1' } : {}),
})
