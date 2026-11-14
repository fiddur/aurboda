import { describe, expect, it } from 'vitest'

import { recordLines } from './records'

describe('recordLines', () => {
  it('puts a single-set record under its set and a summed one on the exercise', () => {
    const sets = [
      { reps: 8, weight: 80 },
      { reps: 5, weight: 90 },
      { reps: 12, set_type: 'warmup', weight: 100 },
    ]
    const lines = recordLines(
      ['e1rm', 'max_weight', 'volume'],
      { e1rm: 101.3, max_weight: 90, volume: 1090 },
      sets,
    )
    expect(lines.bySet.get(sets[1])).toEqual(['PR e1RM 101.3 kg', 'PR weight 90 kg'])
    expect(lines.bySet.get(sets[0])).toBeUndefined()
    expect(lines.session).toHaveLength(1)
    expect(lines.session[0]).toMatch(/^PR volume 1\s090 kg$/)
  })

  it('gives nothing without records', () => {
    expect(recordLines([], {}, [{ reps: 1 }])).toEqual({ bySet: new Map(), session: [] })
  })
})
