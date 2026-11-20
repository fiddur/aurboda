import { describe, expect, test } from 'vitest'

import {
  formatElapsed,
  MICROPHONE_REFUSED,
  pickRecordingMime,
  recordingFileName,
  recordingProblem,
} from './recording'

describe('recording helpers', () => {
  test('prefers WebM, falls back to what the browser has, else lets it choose', () => {
    expect(pickRecordingMime(() => true)).toBe('audio/webm;codecs=opus')
    expect(pickRecordingMime((m) => m === 'audio/mp4')).toBe('audio/mp4')
    expect(pickRecordingMime(() => false)).toBe('')
  })

  test('names the file after its container', () => {
    const at = new Date('2026-11-20T10:11:12Z')
    expect(recordingFileName('audio/webm;codecs=opus', at)).toBe('recording-2026-11-20T10-11-12.webm')
    expect(recordingFileName('audio/mp4', at)).toBe('recording-2026-11-20T10-11-12.m4a')
  })

  test('elapsed time', () => {
    expect(formatElapsed(7_400)).toBe('0:07')
    expect(formatElapsed(754_000)).toBe('12:34')
    expect(formatElapsed(3_723_000)).toBe('1:02:03')
  })

  test('a refused microphone is said plainly', () => {
    expect(recordingProblem({ name: 'NotAllowedError' })).toBe(MICROPHONE_REFUSED)
    expect(recordingProblem(new Error('x'))).toBe('Recording could not start.')
  })
})
