import { describe, expect, it } from 'vitest'

import { exerciseRow } from './timeline-exercises'

describe('exerciseRow', () => {
  it('renders the sets, e1RM, volume and record badges in the Note notation', () => {
    expect(
      exerciseRow({
        metrics: [
          { key: 'e1rm', unit: 'kg', value: 15.2 },
          { key: 'volume', unit: 'kg', value: 196 },
          { key: 'maxWeight', unit: 'kg', value: 12 },
        ],
        name: 'Single Arm Dumbbell Tricep Extension',
        records: ['e1rm', 'maxWeight'],
        sets: [
          { reps: 12, setType: 'warmup', weight: 5 },
          { reps: 10, weight: 10 },
          { reps: 8, weight: 12 },
        ],
      }),
    ).toEqual({
      badges: [
        { label: 'PR e1RM', measure: 'e1rm' },
        { label: 'PR weight', measure: 'max_weight' },
      ],
      name: 'Single Arm Dumbbell Tricep Extension',
      sets: ['12×5 kg (w)', '10×10 kg', '8×12 kg'],
      summary: ['e1RM 15.2 kg', 'volume 196 kg'],
    })
  })

  it('handles bodyweight and timed sets without measures or records', () => {
    expect(
      exerciseRow({ metrics: [], name: 'Plank', sets: [{ time: 90 }, { reps: 15, setType: 'failure' }] }),
    ).toEqual({ badges: [], name: 'Plank', sets: ['1:30', '15 reps (f)'], summary: [] })
  })

  it('drops record keys it does not know', () => {
    expect(exerciseRow({ metrics: [], name: 'Row', records: ['somethingNew'], sets: [] }).badges).toEqual([])
  })
})
