import { describe, expect, test } from 'vitest'

import { declaredProseImages, renderNoteProse, renderProse } from './note-prose.ts'

describe('renderNoteProse tables', () => {
  test('a table becomes one paragraph of labelled lines', () => {
    const md = [
      '| 2h window | Before | During | After | Change |',
      '|---|---|---|---|---|',
      '| Meditation | 37.6 | 27.2 | 34.7 | -2.85 |',
      '| Same time other days | 38.3 | 38.6 | 39.3 | +0.95 |',
      '| Net effect | | | | -3.8 |',
    ].join('\n')
    expect(renderNoteProse(md).trim()).toBe(
      '<p><em>2h window</em><br /><strong>Meditation</strong>: Before 37.6 · During 27.2 · After 34.7 · Change -2.85<br /><strong>Same time other days</strong>: Before 38.3 · During 38.6 · After 39.3 · Change +0.95<br /><strong>Net effect</strong>: Change -3.8</p>',
    )
  })

  test('no corner header: the lines start straight away', () => {
    const md = '| | Before | After |\n|---|---|---|\n| HRV | 40 | 45 |'
    expect(renderNoteProse(md).trim()).toBe('<p><strong>HRV</strong>: Before 40 · After 45</p>')
  })

  test('a row with an empty first cell starts with its values', () => {
    const md = '| Day | Steps | Sleep |\n|---|---|---|\n| | 9000 | 7h |\n| Mon | 8000 | |'
    expect(renderNoteProse(md).trim()).toBe(
      '<p><em>Day</em><br />Steps 9000 · Sleep 7h<br /><strong>Mon</strong>: Steps 8000</p>',
    )
  })

  test('a value under an empty column header stands alone', () => {
    const md = '| Day | |\n|---|---|\n| Mon | 8000 |'
    expect(renderNoteProse(md).trim()).toBe('<p><em>Day</em><br /><strong>Mon</strong>: 8000</p>')
  })

  test('a header-only table is its header cells on one line', () => {
    const md = '| Before | During | After |\n|---|---|---|'
    expect(renderNoteProse(md).trim()).toBe('<p>Before · During · After</p>')
  })

  test('keeps inline formatting inside cells', () => {
    const md = '| Metric | Note |\n|---|---|\n| **HRV** | see [log](https://ex.example/log) and `code` |'
    const html = renderNoteProse(md)
    expect(html).toContain('<strong><strong>HRV</strong></strong>: Note see <a href="https://ex.example/log"')
    expect(html).toContain('<code>code</code>')
  })

  test('a two-column table reads as key: value lines', () => {
    const md = '| Metric | Value |\n|---|---|\n| HRV | 42 |\n| RHR | 51 |'
    expect(renderNoteProse(md).trim()).toBe(
      '<p><em>Metric</em><br /><strong>HRV</strong>: Value 42<br /><strong>RHR</strong>: Value 51</p>',
    )
  })
})

describe('renderNoteProse images', () => {
  test('an image becomes a link to it, named by its alt text or its src', () => {
    const html = renderNoteProse(
      '![A <photo>](https://ex.example/a.png?x=1&y=2) ![](https://ex.example/b.png)',
    )
    expect(html).toContain('<a href="https://ex.example/a.png?x=1&amp;y=2"')
    expect(html).toContain('>A &lt;photo&gt;</a>')
    expect(html).toContain('>https://ex.example/b.png</a>')
    expect(html).not.toContain('<img')
  })

  test('the image option supplies the inline HTML instead', () => {
    const seen: { src: string; alt: string }[] = []
    const html = renderNoteProse('See ![Chart](https://ex.example/c.png) here', {
      image: (image) => {
        seen.push(image)
        return '<em>Figure 1: Chart</em>'
      },
    })
    expect(seen).toEqual([{ alt: 'Chart', src: 'https://ex.example/c.png' }])
    expect(html.trim()).toBe('<p>See <em>Figure 1: Chart</em> here</p>')
  })

  test('a javascript: src loses its href', () => {
    const html = renderNoteProse('![x](javascript:alert(1))')
    expect(html).not.toContain('href="javascript')
  })
})

describe('renderNoteProse boundary', () => {
  test('never emits a table, img or hr, even typed as raw HTML', () => {
    for (const md of [
      '<table><tr><td>raw</td></tr></table>',
      '<img src="https://ex.example/a.png">',
      '| a | b |\n|-|-|\n| 1 | 2 |\n\n---\n\n![i](https://ex.example/i.png)',
    ]) {
      const html = renderNoteProse(md)
      expect(html).not.toContain('<table')
      expect(html).not.toContain('<td')
      expect(html).not.toContain('<img')
      expect(html).not.toContain('<hr')
    }
  })

  test('keeps headings (Mastodon converts them)', () => {
    expect(renderNoteProse('# Title')).toContain('<h1>Title</h1>')
  })

  test('script and onerror never survive, in a table cell or an image alt', () => {
    const html = [
      renderNoteProse('| a | b |\n|-|-|\n| <script>alert(1)</script> | <img src=x onerror=alert(2)> |'),
      renderNoteProse('![<script>alert(3)</script><img src=x onerror=alert(4)>](https://ex.example/a.png)'),
      renderNoteProse('![x" onerror="alert(5)](https://ex.example/a.png)', {
        image: ({ alt }) => `<em>${alt}</em>`,
      }),
    ].join('\n')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).not.toMatch(/<[^>]*\sonerror/)
    expect(html).not.toContain('alert(1)')
  })

  test('plain prose renders exactly like renderProse', () => {
    for (const md of [
      '# Sleep\n\nSlept **well**, see [log](https://ex.example).\nNext line.',
      '- one\n- two\n\n> quoted `code`\n\n1. first',
    ]) {
      expect(renderNoteProse(md)).toBe(renderProse(md))
    }
  })
})

describe('declaredProseImages', () => {
  const fixture = [
    '![Yoga mat](https://example.org/a.webp) in a paragraph',
    '',
    '- ![Coffee cup](https://example.org/b.png) in a list',
    '',
    '| Run | Picture |',
    '|---|---|',
    '| Running | ![](http://example.org/c.jpg) |',
    '',
    '[![Linked](https://example.org/d.webp)](https://example.org/page)',
    '',
    '![Relative](/images/e.webp) ![Inline data](data:image/png;base64,AAAA)',
    '',
    '![Again](https://example.org/a.webp)',
  ].join('\n')

  test('collects http(s) images in document order, once each', () => {
    expect(declaredProseImages(fixture)).toEqual([
      { alt: 'Yoga mat', url: 'https://example.org/a.webp' },
      { alt: 'Coffee cup', url: 'https://example.org/b.png' },
      { alt: '', url: 'http://example.org/c.jpg' },
      { alt: 'Linked', url: 'https://example.org/d.webp' },
    ])
  })

  test('no image declares nothing', () => {
    expect(declaredProseImages('Just **meditation** notes, [a link](https://example.org).')).toEqual([])
  })

  test('matches the http(s) images the Note renders', () => {
    const rendered: { alt: string; url: string }[] = []
    renderNoteProse(fixture, {
      image: ({ alt, src }) => {
        const isNew = /^https?:/.test(src) && !rendered.some((image) => image.url === src)
        if (isNew) rendered.push({ alt, url: src })
        return ''
      },
    })
    expect(declaredProseImages(fixture)).toEqual(rendered)
  })
})
