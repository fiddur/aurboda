import type { ArticleContent } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { renderArticleNote } from './article-object.ts'
import { linkedHashtags, mastodonSanitize, splitTrailingHashtags } from './mastodon-sanitize.ts'

const tagLink = (tag: string, written = tag) =>
  `<a href="https://aurboda.example/u/alice?tag=${tag}" class="mention hashtag" rel="tag">#<span>${written}</span></a>`

describe('mastodonSanitize', () => {
  test('keeps the strict elements', () => {
    const html =
      '<p>a<br />b <del>c</del> <s>d</s> <b>e</b> <strong>f</strong> <u>g</u> <i>h</i> <em>i</em> <span>j</span></p><pre><code>k</code></pre><blockquote><p>l</p></blockquote><ul><li>m</li></ul><ruby>n<rp>(</rp><rt>o</rt><rp>)</rp></ruby>'
    expect(mastodonSanitize(html)).toBe(html)
  })

  test('removes other elements, keeping their text', () => {
    expect(mastodonSanitize('<div>one <table><tr><td>two</td></tr></table><img src="x.png" /></div>')).toBe(
      'one two',
    )
  })

  test('turns a heading into a bold paragraph', () => {
    expect(mastodonSanitize('<h1 id="x">Coffee</h1><h6>Yoga</h6>')).toBe(
      '<p><strong>Coffee</strong></p><p><strong>Yoga</strong></p>',
    )
  })

  test('forces rel and target on a link', () => {
    expect(mastodonSanitize('<a href="https://ex.example/" rel="tag" target="_self">x</a>')).toBe(
      '<a href="https://ex.example/" rel="nofollow noopener" target="_blank">x</a>',
    )
  })

  test('replaces a link with an unsupported or relative href by its text', () => {
    expect(mastodonSanitize('<p><a href="mailto:a@ex.example">mail</a></p>')).toBe('<p>mail</p>')
    expect(mastodonSanitize('<p><a href="javascript:alert(1)">js</a></p>')).toBe('<p>js</p>')
    expect(mastodonSanitize('<p><a href="#figure-5">Figure 5</a></p>')).toBe('<p>Figure 5</p>')
    expect(mastodonSanitize('<p><a>bare</a></p>')).toBe('<p>bare</p>')
    expect(
      mastodonSanitize(
        '<p><a href="#figure-5">Figure 5</a></p><p><a href="https://ex.example/">#<span>yoga</span></a></p>',
      ),
    ).toBe(
      '<p>Figure 5</p><p><a href="https://ex.example/" rel="nofollow noopener" target="_blank">#<span>yoga</span></a></p>',
    )
    expect(mastodonSanitize('<a href="gemini://ex.example/">g</a>')).toBe(
      '<a href="gemini://ex.example/" rel="nofollow noopener" target="_blank">g</a>',
    )
  })

  test('keeps only the classes Mastodon knows', () => {
    expect(mastodonSanitize('<p class="lead h-entry">x</p>')).toBe('<p class="h-entry">x</p>')
    expect(mastodonSanitize('<span class="invisible ellipsis big">x</span>')).toBe(
      '<span class="invisible ellipsis">x</span>',
    )
    expect(mastodonSanitize('<p class="lead">x</p>')).toBe('<p>x</p>')
    expect(mastodonSanitize('<em class="mention">x</em>')).toBe('<em>x</em>')
  })

  test('keeps translate only when it is no', () => {
    expect(mastodonSanitize('<span translate="no">a</span><span translate="yes">b</span>')).toBe(
      '<span translate="no">a</span><span>b</span>',
    )
  })

  test('keeps lang everywhere and the list attributes, drops the rest', () => {
    expect(
      mastodonSanitize('<ol start="3" reversed style="x"><li value="4" id="y" lang="sv">a</li></ol>'),
    ).toBe('<ol start="3" reversed><li value="4" lang="sv">a</li></ol>')
  })

  test("an article Note's content passes through unchanged apart from the forced link attributes", () => {
    const article: ArticleContent = {
      blocks: [
        {
          markdown:
            'Morning **coffee** and [yoga](https://ex.example/yoga).\n\n| day | cups |\n| - | - |\n| Mon | 2 |',
          type: 'prose',
        },
        {
          end: '2026-07-02T00:00:00Z',
          metric: 'heart_rate',
          start: '2026-07-01T00:00:00Z',
          type: 'chart',
        },
        { markdown: '![A cup](https://ex.example/cup.png)', type: 'prose' },
      ],
      title: 'Coffee and yoga',
    }
    const { content } = renderArticleNote(article, (index) => `https://ex.example/blocks/${index}/figure.png`)
    const forced = content.replaceAll('rel="nofollow noopener noreferrer"', 'rel="nofollow noopener"')
    expect(content).toContain('<br')
    expect(mastodonSanitize(content)).toBe(forced)
  })
})

describe('splitTrailingHashtags', () => {
  test('takes a last paragraph of only hashtag links out of the text', () => {
    const html = `<p>Coffee</p>\n<p>${tagLink('coffee')} ${tagLink('yoga', 'Yoga')}</p>`
    expect(splitTrailingHashtags(html)).toEqual({ content: '<p>Coffee</p>', tags: ['coffee', 'yoga'] })
  })

  test('keeps a last paragraph that has other text', () => {
    const html = `<p>Coffee</p><p>Morning ${tagLink('coffee')}</p>`
    expect(splitTrailingHashtags(html)).toEqual({ content: html, tags: [] })
  })

  test('keeps a last paragraph without hashtags, and text without paragraphs', () => {
    expect(splitTrailingHashtags('<p>a</p><p> </p>')).toEqual({ content: '<p>a</p><p> </p>', tags: [] })
    expect(splitTrailingHashtags('plain')).toEqual({ content: 'plain', tags: [] })
  })

  test('works on sanitised links', () => {
    const html = mastodonSanitize(`<p>Run</p><p>${tagLink('running')}</p>`)
    expect(splitTrailingHashtags(html)).toEqual({ content: '<p>Run</p>', tags: ['running'] })
  })
})

describe('linkedHashtags', () => {
  test('lists linked tags once, lowercase', () => {
    expect(linkedHashtags(`<p>${tagLink('yoga', 'Yoga')} and ${tagLink('yoga')}</p>`)).toEqual(['yoga'])
  })
})
