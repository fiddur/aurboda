import { trainingLoadInternalFields, trainingLoadSettingsSchema } from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import { withStoredInternalFields } from './training-load-internal.ts'

describe('withStoredInternalFields', () => {
  const stored = {
    impulse_computed_from: '2025-01-01T00:00:00.000Z',
    impulse_dirty_rev: 7,
    impulse_recompute_lease: { holder: 'process-a', until: '2026-11-18T12:02:00.000Z' },
    impulse_version: 3,
    impulse_watermark: '2026-11-17T08:00:00.000Z',
    observed_hr_max: 191,
    tau_acute: 7,
  }

  test('a stale copy changes the user fields and none of the internal ones', () => {
    const stale = {
      impulse_computed_from: '2026-01-01T00:00:00.000Z',
      impulse_dirty_rev: 6,
      impulse_recompute_lease: { holder: 'process-old', until: '2026-11-18T11:00:00.000Z' },
      impulse_version: 3,
      observed_hr_max: 185,
      tau_acute: 7,
      tau_chronic: 50,
    }
    expect(withStoredInternalFields(stale, stored)).toEqual({ ...stored, tau_chronic: 50 })
  })

  test('an internal field the stored value lacks stays absent', () => {
    const merged = withStoredInternalFields(
      { impulse_dirty_rev: 3, impulse_watermark: 'x', tau_acute: 5 },
      {},
    )
    expect(merged).toEqual({ tau_acute: 5 })
  })

  test('the list holds exactly the fields described as internal', () => {
    const internal = Object.entries(trainingLoadSettingsSchema.shape)
      .filter(([, field]) => field.meta()?.description?.startsWith('Internal:'))
      .map(([name]) => name)
    expect([...trainingLoadInternalFields].sort()).toEqual(internal.sort())
  })
})
