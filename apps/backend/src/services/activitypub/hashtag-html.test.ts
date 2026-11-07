import { Hashtag } from '@fedify/fedify/vocab'
import { describe, expect, test } from 'vitest'

import { hashtagHref, hashtagLinks, hashtagObjects, linkifyHashtags } from './hashtag-html.ts'

const links = hashtagLinks('https://aurboda.example', 'fiddur', ['aurboda', 'running'])
const href = (tag: string) => `https://aurboda.example/u/fiddur?tag=${tag}`
const anchor = (tag: string, text = tag) =>
  `<a href="${href(tag)}" class="mention hashtag" rel="tag">#<span>${text}</span></a>`

describe('linkifyHashtags', () => {
  test('links typed tags in text, keeping the written casing', () => {
    expect(linkifyHashtags('<p>Out for a #Running jog #aurboda</p>', links)).toBe(
      `<p>Out for a ${anchor('running', 'Running')} jog ${anchor('aurboda')}</p>`,
    )
  })

  test('appends the tags the text does not show as one trailing paragraph', () => {
    expect(linkifyHashtags('<p>Morning run</p>', links)).toBe(
      `<p>Morning run</p><p>${anchor('aurboda')} ${anchor('running')}</p>`,
    )
  })

  test('leaves existing links, code and pre alone', () => {
    const html =
      '<p><a href="https://x.example/#running">#running</a> <code>#aurboda</code></p><pre>#running</pre>'
    expect(linkifyHashtags(html, links)).toBe(`${html}<p>${anchor('aurboda')} ${anchor('running')}</p>`)
  })

  test("does not link a typed tag that is not one of the post's tags", () => {
    expect(linkifyHashtags('<p>#other</p>', hashtagLinks('https://a.example', 'u', []))).toBe('<p>#other</p>')
    expect(linkifyHashtags('<p>#other #running</p>', links)).toBe(
      `<p>#other ${anchor('running')}</p><p>${anchor('aurboda')}</p>`,
    )
  })

  test('ignores HTML entities and URL fragments in text', () => {
    const html = '<p>it&#39;s &amp;#x27; example.com/#running</p>'
    expect(linkifyHashtags(html, links)).toBe(`${html}<p>${anchor('aurboda')} ${anchor('running')}</p>`)
  })

  test('escapes the href and encodes the tag', () => {
    const odd = hashtagLinks('https://a.example/"x', 'u', ['löpning'])
    expect(linkifyHashtags('', odd)).toBe(
      '<p><a href="https://a.example/&quot;x/u/u?tag=l%C3%B6pning" class="mention hashtag" rel="tag">#<span>löpning</span></a></p>',
    )
  })

  test('without links or tags the html is unchanged', () => {
    expect(linkifyHashtags('<p>#aurboda</p>', undefined)).toBe('<p>#aurboda</p>')
  })
})

describe('hashtagObjects', () => {
  test('one AS2 Hashtag per tag, named with # and linked to the filtered profile', () => {
    const tags = hashtagObjects(links)
    expect(tags.every((tag) => tag instanceof Hashtag)).toBe(true)
    expect(tags.map((tag) => [tag.name?.toString(), tag.href?.href])).toEqual([
      ['#aurboda', href('aurboda')],
      ['#running', href('running')],
    ])
    expect(hashtagHref('https://a.example/u/x', 'a b')).toBe('https://a.example/u/x?tag=a%20b')
  })
})
