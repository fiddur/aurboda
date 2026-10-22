import { getLogger, type LogRecord, reset } from '@logtape/logtape'
import { afterEach, describe, expect, test } from 'vitest'

import { configureFederationLogging } from './logging.ts'

describe('configureFederationLogging', () => {
  afterEach(() => reset())

  test('routes fedify records at warning and above to the sink, and drops the rest', async () => {
    const records: LogRecord[] = []
    await configureFederationLogging({ sink: (record) => records.push(record) })

    const sig = getLogger(['fedify', 'sig', 'http'])
    sig.debug('Failed to verify; no Signature header found.')
    sig.info('Fetching key...')
    sig.error('Failed to verify the request signature.')
    getLogger(['fedify', 'federation', 'inbox']).warning('Unsupported activity')
    getLogger(['aurboda']).error('not fedify')

    expect(records.map((r) => [r.category, r.level, r.message.join('')])).toEqual([
      [['fedify', 'sig', 'http'], 'error', 'Failed to verify the request signature.'],
      [['fedify', 'federation', 'inbox'], 'warning', 'Unsupported activity'],
    ])
  })

  test('can be called again without throwing', async () => {
    await configureFederationLogging({ sink: () => {} })
    await expect(configureFederationLogging({ sink: () => {} })).resolves.toBeUndefined()
  })
})
