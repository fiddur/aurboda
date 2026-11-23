import { isPeopleBreakdownField } from '@aurboda/api-spec'

import type { BarClickInfo } from '../../components/charts/BarChart'

export const computeBucketEnd = (start: Date, bucketSize: string): Date => {
  const end = new Date(start)
  switch (bucketSize) {
    case '1m':
      end.setMinutes(end.getMinutes() + 1)
      break
    case '5m':
      end.setMinutes(end.getMinutes() + 5)
      break
    case '15m':
      end.setMinutes(end.getMinutes() + 15)
      break
    case '1h':
      end.setHours(end.getHours() + 1)
      break
    case '1d':
      end.setDate(end.getDate() + 1)
      break
    case '1w':
      end.setDate(end.getDate() + 7)
      break
    case '1M':
      end.setMonth(end.getMonth() + 1)
      break
  }
  return end
}

/** The data page over a clicked bar's bucket, filtered by its series' data-field values (`@people` has no data filter). */
export const buildBarDataHref = (
  info: BarClickInfo,
  pattern: string,
  bucketSize: string,
  breakdownFields?: string[],
): string => {
  const bucketStart = new Date(info.bucket_start)
  const bucketEnd = computeBucketEnd(bucketStart, bucketSize)

  const urlParams = new URLSearchParams()
  urlParams.set('from', bucketStart.toISOString())
  urlParams.set('to', bucketEnd.toISOString())
  urlParams.set('date', bucketStart.toISOString().slice(0, 10))
  urlParams.set('types', pattern)
  urlParams.set('hide', 'location,media,meal,report,screentime')

  if (info.series_name && breakdownFields?.length) {
    const values = info.series_name.split(' / ')
    const filters = breakdownFields
      .flatMap((field, i) => (isPeopleBreakdownField(field) ? [] : [`${field}:${values[i] ?? '(none)'}`]))
      .join(',')
    if (filters) urlParams.set('data_filter', filters)
  }

  return `/data?${urlParams}`
}
