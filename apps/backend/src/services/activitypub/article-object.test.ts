import type { ArticleContent } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { CHART_HEIGHT, CHART_WIDTH } from '../charts/chart-svg.ts'
import { FIGURE_BAND_HEIGHT } from '../charts/figure-svg.ts'
import { IMPACT_HEIGHT, IMPACT_WIDTH } from '../charts/impact-svg.ts'
import { SCATTER_HEIGHT, SCATTER_WIDTH } from '../charts/scatter-svg.ts'
import { feedImageUrl } from '../feed-image.ts'
import {
  articleFigureName,
  MASTODON_ATTACHMENT_LIMIT,
  proseToPlainText,
  renderArticleNote,
  renderProse,
} from './article-object.ts'

const WINDOW = { end: '2026-07-02T00:00:00Z', start: '2026-07-01T00:00:00Z' }

const article = (blocks: ArticleContent['blocks']): ArticleContent => ({ blocks, title: 'My analysis' })

const FIGURE_URL = (index: number) =>
  `https://aurboda.example/api/public/fiddur/feed/POST/blocks/${index}/figure.png`
const note = (blocks: ArticleContent['blocks']) => renderArticleNote(article(blocks), FIGURE_URL)
const chart = { end: WINDOW.end, metric: 'heart_rate', start: WINDOW.start, type: 'chart' } as const
const correlation = {
  end: WINDOW.end,
  outcome: { kind: 'metric', metric: 'sleep_score' },
  start: WINDOW.start,
  trigger: { kind: 'metric', metric: 'steps' },
  type: 'correlation',
} as const

describe('renderArticleNote content', () => {
  test('leads the content with the title (Mastodon ignores a Note’s name)', () => {
    // An all-charts article with no captions still federates a non-empty status —
    // the title — rather than just attachment URLs.
    expect(note([chart]).content).toContain('<p><strong>My analysis</strong></p>')
  })

  test('renders prose markdown to HTML', () => {
    const { content } = note([{ markdown: '# Sleep\n\nSlept **well**.', type: 'prose' }])
    expect(content).toContain('<h1')
    expect(content).toContain('Sleep')
    expect(content).toContain('<strong>well</strong>')
  })

  test('strips script/style from authored markdown (the #910 boundary, server side)', () => {
    const { content } = note([
      { markdown: 'Hi <script>alert(1)</script> <img src=x onerror=alert(2)>', type: 'prose' },
    ])
    expect(content).not.toContain('<script')
    expect(content).not.toContain('alert(1)')
    expect(content).not.toContain('onerror')
  })

  test('shapes tables and images for Mastodon: no table, img or hr in the Note', () => {
    const md = '| a | b |\n| - | - |\n| 1 | 2 |\n\n![alt](https://ex.example/p.png)\n\n---\n\n###### h6'
    const { content } = note([{ markdown: md, type: 'prose' }])
    expect(content).toContain('<strong>1</strong>: b 2')
    expect(content).not.toContain('<table')
    expect(content).not.toContain('<img')
    expect(content).not.toContain('<hr')
    expect(content).toContain('<em>Figure 1: alt</em>')
    expect(content).toContain('<h6')
  })

  test('the Atom path (renderProse) still keeps full HTML tables and images', () => {
    const html = renderProse('| a | b |\n| - | - |\n| 1 | 2 |\n\n![alt](https://ex.example/p.png)')
    expect(html).toContain('<table>')
    expect(html).toContain('<td>1</td>')
    expect(html).toContain('<img')
  })

  test('emits a caption as plain escaped text, not markdown (matches the web figcaption)', () => {
    const { content } = note([{ ...chart, caption: '**not bold** <b>x</b>' }])
    expect(content).toContain('<p><em>Figure 1: **not bold** &lt;b&gt;x&lt;/b&gt;</em></p>')
    expect(content).not.toContain('<strong>not bold')
    expect(content).not.toContain('<b>x</b>')
  })

  test('refers to each block by figure number and label, falling back from caption to data label', () => {
    const { content } = note([
      { markdown: 'Intro', type: 'prose' },
      { ...chart, caption: 'HR trend' },
      { ...chart, metric: 'steps' },
    ])
    expect(content).toContain('Intro')
    expect(content).toContain('<p><em>Figure 1: HR trend</em></p>')
    expect(content).toMatch(/<p><em>Figure 2: [^<]+<\/em><\/p>/)
    expect(content).not.toContain('<img')
  })

  test('numbers prose images and blocks together, in document order', () => {
    const { content, figures } = note([
      { ...chart, caption: 'A' },
      { markdown: 'See ![Photo](https://ex.example/a.jpg) here', type: 'prose' },
      { ...correlation, caption: 'C' },
    ])
    expect(figures.map((f) => [f.number, f.label])).toEqual([
      [1, 'A'],
      [2, 'Photo'],
      [3, 'C'],
    ])
    expect(content).toContain('See <em>Figure 2: Photo</em> here')
    expect(content).toContain('<p><em>Figure 3: C</em></p>')
  })

  test('a prose image without alt is referred to as just Figure N', () => {
    const { content } = note([{ markdown: '![](https://ex.example/a.png)', type: 'prose' }])
    expect(content).toContain('<em>Figure 1</em>')
  })

  test('a non-http(s) prose image is not a figure: only its alt text remains', () => {
    const { content, figures } = note([
      { markdown: 'A ![shot](data:image/png;base64,AAAA) and ![](javascript:alert(1))', type: 'prose' },
      chart,
    ])
    expect(figures).toHaveLength(1)
    expect(figures[0].block_index).toBe(1)
    expect(content).toContain('A shot and')
    expect(content).not.toContain('javascript')
    expect(content).not.toContain('data:image')
  })

  test('past the attachment limit, the figure reference links to the image', () => {
    const blocks = [1, 2, 3, 4, 5].map((n) => ({ ...chart, caption: `C${n}` }))
    const { content } = note(blocks)
    for (const n of [1, 2, 3, 4]) expect(content).toContain(`<p><em>Figure ${n}: C${n}</em></p>`)
    expect(content).toContain(`<p><em><a href="${FIGURE_URL(4)}">Figure 5</a>: C5</em></p>`)
    expect(MASTODON_ATTACHMENT_LIMIT).toBe(4)
  })

  test('a prose image past the limit links to its src', () => {
    const blocks = [
      chart,
      chart,
      chart,
      chart,
      { markdown: '![Five](https://ex.example/5.png)', type: 'prose' },
    ]
    const { content } = note(blocks as ArticleContent['blocks'])
    expect(content).toContain('<em><a href="https://ex.example/5.png"')
    expect(content).toContain('>Figure 5</a>: Five</em>')
  })

  test('a challenge block keeps its escaped join link after its reference', () => {
    const { content } = note([
      {
        caption: 'Steps <race>',
        challenge_url: 'https://qs.example/u/olle/nov?a=1&b="2"',
        type: 'challenge',
      },
      { challenge_url: 'https://other.example/u/eva/oct', type: 'challenge' },
    ])
    expect(content).toContain(
      '<p><em>Figure 1: Steps &lt;race&gt;</em></p>\n<p><a href="https://qs.example/u/olle/nov?a=1&amp;b=&quot;2&quot;">Join the challenge</a></p>',
    )
    expect(content).toContain(
      '<p><em>Figure 2: Challenge standings</em></p>\n<p><a href="https://other.example/u/eva/oct">Join the challenge</a></p>',
    )
  })
})

describe('renderArticleNote figures', () => {
  test('a block figure points at its figure URL, sized as the chart plus the title band', () => {
    const { figures } = note([
      { markdown: 'Intro', type: 'prose' },
      chart,
      correlation,
      { challenge_url: 'https://qs.example/u/olle/nov', type: 'challenge' },
      { ...WINDOW, activity: 'yoga', activity_type: 'activity_type', type: 'impact' },
    ])
    expect(figures).toEqual([
      {
        block_index: 1,
        height: CHART_HEIGHT + FIGURE_BAND_HEIGHT,
        label: 'Heart Rate',
        media_type: 'image/png',
        number: 1,
        url: FIGURE_URL(1),
        width: CHART_WIDTH,
      },
      {
        block_index: 2,
        height: SCATTER_HEIGHT + FIGURE_BAND_HEIGHT,
        label: expect.stringContaining('steps'),
        media_type: 'image/png',
        number: 2,
        url: FIGURE_URL(2),
        width: SCATTER_WIDTH,
      },
      {
        block_index: 3,
        height: CHART_HEIGHT + FIGURE_BAND_HEIGHT,
        label: 'Challenge standings',
        media_type: 'image/png',
        number: 3,
        url: FIGURE_URL(3),
        width: CHART_WIDTH,
      },
      {
        block_index: 4,
        height: IMPACT_HEIGHT + FIGURE_BAND_HEIGHT,
        label: 'Impact of yoga',
        media_type: 'image/png',
        number: 4,
        url: FIGURE_URL(4),
        width: IMPACT_WIDTH,
      },
    ])
  })

  test('a prose image figure carries its src, alt and a media type from its extension', () => {
    const md = [
      '![a](https://ex.example/a.PNG)',
      '![b](https://ex.example/b.jpeg?x=1)',
      '![c](https://ex.example/c.webp)',
      '![d](https://ex.example/d.gif)',
      '![e](https://ex.example/e.avif)',
      '![f](https://ex.example/f)',
    ].join(' ')
    const { figures } = note([{ markdown: md, type: 'prose' }])
    expect(figures.map((f) => [f.url, f.label, f.media_type, f.block_index, f.width])).toEqual([
      ['https://ex.example/a.PNG', 'a', 'image/png', undefined, undefined],
      ['https://ex.example/b.jpeg?x=1', 'b', 'image/jpeg', undefined, undefined],
      ['https://ex.example/c.webp', 'c', 'image/webp', undefined, undefined],
      ['https://ex.example/d.gif', 'd', 'image/gif', undefined, undefined],
      ['https://ex.example/e.avif', 'e', 'image/avif', undefined, undefined],
      ['https://ex.example/f', 'f', undefined, undefined, undefined],
    ])
  })

  test('an uploaded picture becomes a numbered WebP figure with its alt text', () => {
    const url = feedImageUrl('https://aurboda.example/api', 'fiddur', '1b4e28ba-2fa1-41d2-883f-0016d3cca427')
    const { figures } = note([{ markdown: `Morning coffee:\n\n![A cup of coffee](${url})`, type: 'prose' }])
    expect(figures).toEqual([
      expect.objectContaining({ label: 'A cup of coffee', media_type: 'image/webp', number: 1, url }),
    ])
  })

  test('no figures for a prose-only article without images', () => {
    expect(note([{ markdown: 'Just words', type: 'prose' }]).figures).toEqual([])
  })

  test('articleFigureName names a figure with or without a label', () => {
    expect(articleFigureName({ label: 'HR', number: 2 })).toBe('Figure 2: HR')
    expect(articleFigureName({ label: '', number: 3 })).toBe('Figure 3')
  })
})

describe('proseToPlainText', () => {
  test('drops markdown formatting, links and images, keeping the words on one line', () => {
    expect(
      proseToPlainText(
        '# Sleep vs HRV\n\nA **close** look at [my data](https://x.test) & <script>alert(1)</script> "notes".\n\n![chart](https://x.test/c.png)',
      ),
    ).toBe('Sleep vs HRV A close look at my data & "notes".')
  })
})
