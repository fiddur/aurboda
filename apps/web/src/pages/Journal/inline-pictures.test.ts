// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

import {
  attachmentImageMarkdown,
  inlineAttachmentIds,
  resolveInlinePictures,
  withoutInline,
} from './inline-pictures'

const a = '3f0c2b1a-9d8e-4f7a-8b6c-5d4e3f2a1b0c'
const b = '7e6d5c4b-3a29-4180-9f8e-7d6c5b4a3928'
const c = '11111111-2222-4333-8444-555555555555'

describe('attachmentImageMarkdown', () => {
  it('writes a picture that names the attachment', () => {
    expect(attachmentImageMarkdown(a)).toBe(`![](attachment:${a})`)
  })
})

describe('inlineAttachmentIds', () => {
  it('finds every attachment picture, alt text or not, in any case', () => {
    const text = `Morning.\n![](attachment:${a})\nThen ![the lake](ATTACHMENT:${b.toUpperCase()}) and more.`
    expect(inlineAttachmentIds(text)).toEqual(new Set([a, b]))
  })

  it('ignores links, other URLs and malformed ids', () => {
    const text = `[link](attachment:${a}) ![x](https://example.com/${b}) ![y](attachment:nope)`
    expect(inlineAttachmentIds(text).size).toBe(0)
  })
})

describe('withoutInline', () => {
  it('keeps the attachments the text does not show, in order', () => {
    const list = [{ id: a }, { id: b }, { id: c }]
    expect(withoutInline(list, `![](attachment:${b})`)).toEqual([{ id: a }, { id: c }])
    expect(withoutInline(list, 'no pictures')).toEqual(list)
  })
})

const containerWith = (html: string) => {
  const box = document.createElement('div')
  box.innerHTML = html
  return box
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const fakeUrls = () => {
  let n = 0
  return {
    createObjectURL: vi.fn(() => `blob:test/${(n += 1)}`),
    revokeObjectURL: vi.fn(),
  }
}

describe('resolveInlinePictures', () => {
  it('fills each picture in, fetching a repeated one only once', async () => {
    const box = containerWith(
      `<img data-attachment-id="${a}"><img data-attachment-id="${a}"><img data-attachment-id="${b}">`,
    )
    const fetchBlob = vi.fn(async () => new Blob(['x']))
    const objectUrls = fakeUrls()
    const cleanup = resolveInlinePictures(box, { fetchBlob, maxEdge: '2000', noteId: 'n1', objectUrls })
    await settle()
    expect(fetchBlob).toHaveBeenCalledTimes(2)
    expect(fetchBlob).toHaveBeenCalledWith('n1', a, '2000')
    const imgs = [...box.querySelectorAll('img')]
    expect(imgs.map((img) => img.getAttribute('src'))).toEqual(['blob:test/1', 'blob:test/1', 'blob:test/2'])
    expect(imgs.every((img) => img.classList.contains('journal-inline-picture'))).toBe(true)
    cleanup()
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledTimes(2)
  })

  it('says a picture is missing when it cannot be fetched', async () => {
    const box = containerWith(`<p><img data-attachment-id="${a}"></p>`)
    resolveInlinePictures(box, {
      fetchBlob: () => Promise.reject(new Error('404')),
      maxEdge: '400',
      noteId: 'n1',
      objectUrls: fakeUrls(),
    })
    await settle()
    expect(box.querySelector('img')).toBeNull()
    expect(box.textContent).toBe('Picture missing')
  })

  it('leaves the page alone once cleaned up, and frees a late picture', async () => {
    const box = containerWith(`<img data-attachment-id="${a}">`)
    let deliver: (blob: Blob) => void = () => undefined
    const objectUrls = fakeUrls()
    const cleanup = resolveInlinePictures(box, {
      fetchBlob: () => new Promise<Blob>((resolve) => (deliver = resolve)),
      maxEdge: '400',
      noteId: 'n1',
      objectUrls,
    })
    cleanup()
    deliver(new Blob(['x']))
    await settle()
    expect(box.querySelector('img')?.getAttribute('src')).toBeNull()
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith('blob:test/1')
  })

  it('opens a picture on click or Enter, until cleaned up', async () => {
    const box = containerWith(`<img data-attachment-id="${a}">`)
    const onOpen = vi.fn()
    const cleanup = resolveInlinePictures(box, {
      fetchBlob: async () => new Blob(['x']),
      maxEdge: '400',
      noteId: 'n1',
      objectUrls: fakeUrls(),
      onOpen,
    })
    const img = box.querySelector('img') as HTMLImageElement
    img.click()
    img.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(onOpen).toHaveBeenCalledTimes(2)
    expect(onOpen).toHaveBeenCalledWith(a)
    cleanup()
    img.click()
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('skips an id that is not a uuid', async () => {
    const box = containerWith('<img data-attachment-id="../../x">')
    const fetchBlob = vi.fn(async () => new Blob(['x']))
    resolveInlinePictures(box, { fetchBlob, maxEdge: '400', noteId: 'n1', objectUrls: fakeUrls() })
    await settle()
    expect(fetchBlob).not.toHaveBeenCalled()
  })
})
