import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  canPrecedeHandle,
  distinctHandles,
  findHandles,
  handleAtStart,
  handleStartIndex,
} from './fediverse-handles.ts'

const handles = (markdown: string): string[] => findHandles(markdown).map((m) => m.handle)

describe('findHandles', () => {
  it('finds a handle at the start, after whitespace and after opening punctuation', () => {
    assert.deepEqual(handles('@delvoriah@aurboda.net wrote'), ['@delvoriah@aurboda.net'])
    assert.deepEqual(handles('Thanks @anna@example.social!'), ['@anna@example.social'])
    assert.deepEqual(handles('(see @a_b.c@sub.example.org)'), ['@a_b.c@sub.example.org'])
    assert.deepEqual(handles('**@bold@example.org**'), ['@bold@example.org'])
  })

  it('splits a match into username, host and index', () => {
    assert.deepEqual(findHandles('hi @anna@example.social'), [
      { handle: '@anna@example.social', host: 'example.social', index: 3, username: 'anna' },
    ])
  })

  it('leaves a trailing full stop out of the host', () => {
    assert.deepEqual(handles('Ask @a@b.se.'), ['@a@b.se'])
  })

  it('does not take an e-mail address, or the tail of one', () => {
    assert.deepEqual(handles('mail delvoriah@aurboda.net'), [])
    assert.deepEqual(handles('a@user@host.se'), [])
  })

  it('needs a dot in the host and no longer word after it', () => {
    assert.deepEqual(handles('@anna@localhost'), [])
    assert.deepEqual(handles('@anna@example.org/path'), [])
    assert.deepEqual(handles('@anna@example.org@more'), [])
  })

  it('skips code, URLs, links and autolinks', () => {
    assert.deepEqual(handles('`@a@b.se`'), [])
    assert.deepEqual(handles('```\n@a@b.se\n```'), [])
    assert.deepEqual(handles('https://example.org/ @x@y.se'), ['@x@y.se'])
    assert.deepEqual(handles('see https://example.org/@a@b.se'), [])
    assert.deepEqual(handles('[@a@b.se](https://b.se/@a)'), [])
    assert.deepEqual(handles('<https://b.se/@a@b.se>'), [])
  })

  it('finds several handles', () => {
    assert.deepEqual(handles('@a@b.se and @c@d.org, @a@b.se'), ['@a@b.se', '@c@d.org', '@a@b.se'])
  })
})

describe('distinctHandles', () => {
  it('dedupes case-insensitively across texts, first seen kept', () => {
    assert.deepEqual(
      distinctHandles(['@Anna@Example.org', '@anna@example.org and @b@c.se'], 10).map((m) => m.handle),
      ['@Anna@Example.org', '@b@c.se'],
    )
  })

  it('stops at the limit', () => {
    const text = Array.from({ length: 12 }, (_, i) => `@u${i}@example.org`).join(' ')
    assert.equal(distinctHandles([text], 10).length, 10)
  })
})

describe('handleAtStart / handleStartIndex / canPrecedeHandle', () => {
  it('matches only at the start', () => {
    assert.equal(handleAtStart('@a@b.se rest')?.handle, '@a@b.se')
    assert.equal(handleAtStart('x @a@b.se'), null)
  })

  it('finds the first handle start after an allowed character', () => {
    assert.equal(handleStartIndex('hi @a@b.se'), 3)
    assert.equal(handleStartIndex('x@a@b.se'), -1)
    assert.equal(handleStartIndex('@a@b.se'), 0)
  })

  it('allows the start, whitespace and opening punctuation before a handle', () => {
    assert.equal(canPrecedeHandle(undefined), true)
    assert.equal(canPrecedeHandle(' '), true)
    assert.equal(canPrecedeHandle('('), true)
    assert.equal(canPrecedeHandle('a'), false)
    assert.equal(canPrecedeHandle('/'), false)
  })
})
