/** Build a /chart URL from widget config parameters. */
export function buildChartUrl(params: {
  aggregation?: string
  bucket_size?: string
  chart_type: 'trend' | 'bar'
  display_period?: string
  half_life_days?: number
  lookback_days?: number
  pattern?: string
  source_type: string
  tag_definition_id?: string
}): string {
  const qs = new URLSearchParams()
  qs.set('source_type', params.source_type)
  if (params.pattern) qs.set('pattern', params.pattern)
  if (params.tag_definition_id) qs.set('tag_definition_id', params.tag_definition_id)
  if (params.lookback_days) qs.set('lookback_days', String(params.lookback_days))
  qs.set('chart_type', params.chart_type)

  if (params.chart_type === 'trend') {
    if (params.display_period) qs.set('display_period', params.display_period)
    if (params.half_life_days) qs.set('half_life_days', String(params.half_life_days))
  } else {
    if (params.bucket_size) qs.set('bucket_size', params.bucket_size)
  }

  if (params.aggregation && params.aggregation !== 'count') {
    qs.set('aggregation', params.aggregation)
  }

  return `/chart?${qs}`
}
