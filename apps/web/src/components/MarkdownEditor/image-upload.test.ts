import { describe, expect, test } from 'vitest'

import {
  freePlaceholder,
  imageMarkdown,
  insertAt,
  insertOnOwnLine,
  messageForFailure,
  removePlaceholder,
  replaceFirst,
  stillUploading,
  uploadPlaceholder,
} from './image-upload'

describe('uploadPlaceholder and stillUploading', () => {
  test('a placeholder names the picture and marks the text as still uploading', () => {
    expect(uploadPlaceholder('coffee.jpg')).toBe('![Uploading coffee.jpg…]()')
    expect(stillUploading(`Morning\n${uploadPlaceholder('coffee.jpg')}\n`)).toBe(true)
    expect(stillUploading('Morning\n![](https://aurboda.test/api/public/alice/images/x.webp)')).toBe(false)
  })
})

describe('freePlaceholder', () => {
  test('numbers a placeholder whose name is already in the text', () => {
    const one = uploadPlaceholder('yoga.png')
    expect(freePlaceholder('', 'yoga.png')).toBe(one)
    expect(freePlaceholder(one, 'yoga.png')).toBe(uploadPlaceholder('yoga.png (2)'))
    expect(freePlaceholder(`${one}${uploadPlaceholder('yoga.png (2)')}`, 'yoga.png')).toBe(
      uploadPlaceholder('yoga.png (3)'),
    )
  })
})

describe('insertAt', () => {
  test('inserts at the position, clamped to the text', () => {
    expect(insertAt('abcd', 2, 'X')).toBe('abXcd')
    expect(insertAt('abcd', -5, 'X')).toBe('Xabcd')
    expect(insertAt('abcd', 99, 'X')).toBe('abcdX')
  })
})

describe('insertOnOwnLine', () => {
  test('into empty text, adds only a newline after', () => {
    expect(insertOnOwnLine('', 0, 'P')).toEqual({ end: 2, value: 'P\n' })
  })

  test('in the middle of a line, breaks the line on both sides', () => {
    expect(insertOnOwnLine('coffee time', 6, 'P')).toEqual({ end: 9, value: 'coffee\nP\n time' })
  })

  test('at the start of a line, adds only the newline after', () => {
    expect(insertOnOwnLine('yoga\nrunning', 5, 'P')).toEqual({ end: 7, value: 'yoga\nP\nrunning' })
  })

  test('at the end of a line followed by another, adds only the newline before', () => {
    expect(insertOnOwnLine('yoga\nrunning', 4, 'P')).toEqual({ end: 6, value: 'yoga\nP\nrunning' })
  })

  test('at the end of the text, adds a newline before and after', () => {
    expect(insertOnOwnLine('meditation', 10, 'P')).toEqual({ end: 13, value: 'meditation\nP\n' })
  })

  test('clamps the position to the text', () => {
    expect(insertOnOwnLine('ab', 99, 'P').value).toBe('ab\nP\n')
    expect(insertOnOwnLine('ab', -1, 'P').value).toBe('P\nab')
  })

  test('a second insertion at the first one’s end lands on the next line', () => {
    const first = insertOnOwnLine('coffee', 6, 'A')
    expect(insertOnOwnLine(first.value, first.end, 'B').value).toBe('coffee\nA\nB\n')
  })
})

describe('replaceFirst and removePlaceholder', () => {
  test('replaceFirst replaces only the first occurrence and leaves text without it alone', () => {
    expect(replaceFirst('a-b-a', 'a', 'X')).toBe('X-b-a')
    expect(replaceFirst('abc', 'z', 'X')).toBe('abc')
  })

  test('removePlaceholder takes the line break placed after it too', () => {
    const p = uploadPlaceholder('coffee.jpg')
    expect(removePlaceholder(`yoga\n${p}\nrunning`, p)).toBe('yoga\nrunning')
    expect(removePlaceholder(`yoga ${p}`, p)).toBe('yoga ')
  })
})

describe('imageMarkdown', () => {
  test('embeds the URL with empty alt text', () => {
    expect(imageMarkdown('https://aurboda.test/api/public/alice/images/x.webp')).toBe(
      '![](https://aurboda.test/api/public/alice/images/x.webp)',
    )
  })
})

describe('messageForFailure', () => {
  test.each([
    [415, 'That is not a picture Aurboda can use. PNG, JPEG, WebP or GIF works.'],
    [413, 'That picture is too large to send.'],
    [409, 'You have stored as many pictures as one account may hold (500). Delete some first.'],
    [401, 'You have been signed out. Sign in again and have another go.'],
  ])('a %i says so in plain words', (status, message) => {
    expect(messageForFailure(Object.assign(new Error('x'), { status }))).toBe(message)
  })

  test('a network failure asks to check the connection', () => {
    expect(messageForFailure(Object.assign(new Error('Network Error'), { network: true }))).toBe(
      'Could not reach Aurboda. Check the connection and try again.',
    )
  })

  test('anything else asks to try again', () => {
    expect(messageForFailure(Object.assign(new Error('x'), { status: 500 }))).toBe(
      'Could not send that picture. Please try again.',
    )
    expect(messageForFailure('odd')).toBe('Could not send that picture. Please try again.')
  })
})
