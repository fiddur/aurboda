/**
 * Origin of a chart the user navigated from: identifies the exact board widget
 * so the chart page can offer to update it in place. `board_id` is 'home' for
 * the private dashboard or a shared-dashboard id.
 */
export interface ChartOrigin {
  board_id: string
  section_id: string
  widget_id: string
}

interface ChartUrlParams {
  aggregation?: string
  bucket_size?: string
  chart_type: 'trend' | 'bar'
  display_period?: string
  half_life_days?: number
  lookback_days?: number
  pattern?: string
  source_type: string
  activity_type_id?: string
  breakdown_fields?: string[]
  missing_days?: string
  origin?: ChartOrigin
}

function setModeParams(qs: URLSearchParams, params: ChartUrlParams) {
  if (params.chart_type === 'trend') {
    if (params.display_period) qs.set('display_period', params.display_period)
    if (params.half_life_days) qs.set('half_life_days', String(params.half_life_days))
    if (params.missing_days && params.source_type === 'metric') qs.set('missing_days', params.missing_days)
  } else if (params.bucket_size) {
    qs.set('bucket_size', params.bucket_size)
  }
}

export function buildChartUrl(params: ChartUrlParams): string {
  const qs = new URLSearchParams()
  qs.set('source_type', params.source_type)
  if (params.pattern) qs.set('pattern', params.pattern)
  if (params.activity_type_id) qs.set('activity_type_id', params.activity_type_id)
  if (params.breakdown_fields?.length) qs.set('breakdown_fields', params.breakdown_fields.join(','))
  if (params.lookback_days) qs.set('lookback_days', String(params.lookback_days))
  qs.set('chart_type', params.chart_type)

  setModeParams(qs, params)

  if (params.aggregation && (params.aggregation !== 'count' || params.source_type === 'metric')) {
    qs.set('aggregation', params.aggregation)
  }

  if (params.origin) {
    qs.set('board_id', params.origin.board_id)
    qs.set('section_id', params.origin.section_id)
    qs.set('widget_id', params.origin.widget_id)
  }

  return `/chart?${qs}`
}
