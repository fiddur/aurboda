const SUB_DAY_BUCKETS = new Set(['1m', '5m', '15m', '1h'])

/** All time spans years, so a bucket under a day, one bar per minute or hour of them, widens to a month. */
export const allTimeBucket = <B extends string>(bucket: B): B | '1M' =>
  SUB_DAY_BUCKETS.has(bucket) ? '1M' : bucket
