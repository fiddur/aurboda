import { describe, expect, it } from 'vitest'

import { safeBackPath } from './backPath'

describe('safeBackPath', () => {
  it('accepts a same-origin path', () => {
    expect(safeBackPath('/activity/merged:abc')).toBe('/activity/merged:abc')
    expect(safeBackPath('/activity/merged%3Aabc?x=1#y')).toBe('/activity/merged%3Aabc?x=1#y')
  })

  it('rejects anything that could leave the site', () => {
    expect(safeBackPath(undefined)).toBeUndefined()
    expect(safeBackPath('')).toBeUndefined()
    expect(safeBackPath('//evil.example/x')).toBeUndefined()
    expect(safeBackPath('/\\evil.example')).toBeUndefined()
    expect(safeBackPath('/a\\b')).toBeUndefined()
    expect(safeBackPath('https://evil.example/')).toBeUndefined()
    expect(safeBackPath('javascript:alert(1)')).toBeUndefined()
    expect(safeBackPath('activity/1')).toBeUndefined()
    expect(safeBackPath('/a b')).toBeUndefined()
    expect(safeBackPath('/\tx')).toBeUndefined()
  })
})
