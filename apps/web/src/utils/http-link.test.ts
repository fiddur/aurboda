import { describe, expect, test } from 'vitest'

import { httpLink } from './http-link'

describe('httpLink', () => {
  test('keeps http(s) URLs', () => {
    expect(httpLink('https://peer.example/u/x/bench')).toBe('https://peer.example/u/x/bench')
    expect(httpLink('http://peer.example/u/x/bench')).toBe('http://peer.example/u/x/bench')
  })

  test('drops every other scheme, junk and absence', () => {
    expect(httpLink('javascript:alert(document.cookie)')).toBeUndefined()
    expect(httpLink('data:text/html,<script>alert(1)</script>')).toBeUndefined()
    expect(httpLink('not a url')).toBeUndefined()
    expect(httpLink(undefined)).toBeUndefined()
  })
})
