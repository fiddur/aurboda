import { describe, expect, test, vi } from 'vitest'

import type { BarcodeReader } from './barcodeReader'

import { runScanLoop } from './barcodeScanLoop'

const video = {} as HTMLVideoElement

const fakeScheduler = () => {
  const queue: { fn: () => void; ms: number }[] = []
  return {
    queue,
    runNext: async () => {
      const next = queue.shift()
      next?.fn()
      await new Promise((resolve) => setImmediate(resolve))
    },
    schedule: (fn: () => void, ms: number) => {
      queue.push({ fn, ms })
    },
  }
}

const readerOf = (...frames: (string | null | Error)[]): BarcodeReader & { calls: number } => {
  const reader = {
    calls: 0,
    detect: () => {
      const frame = frames[reader.calls++] ?? null
      return frame instanceof Error ? Promise.reject(frame) : Promise.resolve(frame)
    },
  }
  return reader
}

describe('runScanLoop', () => {
  test('reads frames intervalMs apart until the first code, then stops', async () => {
    const scheduler = fakeScheduler()
    const reader = readerOf(null, null, '3017624010701', '96385074')
    const onCode = vi.fn()
    runScanLoop({ onCode, reader, schedule: scheduler.schedule, signal: new AbortController().signal, video })

    expect(scheduler.queue.map((q) => q.ms)).toEqual([0])
    await scheduler.runNext()
    expect(scheduler.queue.map((q) => q.ms)).toEqual([150])
    await scheduler.runNext()
    await scheduler.runNext()
    expect(onCode).toHaveBeenCalledOnce()
    expect(onCode).toHaveBeenCalledWith('3017624010701')
    expect(scheduler.queue).toEqual([])
    expect(reader.calls).toBe(3)
  })

  test('stops when the signal aborts, also while a frame is being read', async () => {
    const scheduler = fakeScheduler()
    const controller = new AbortController()
    let finish: (code: string | null) => void = () => {}
    const reader: BarcodeReader = { detect: () => new Promise((resolve) => (finish = resolve)) }
    const onCode = vi.fn()
    runScanLoop({
      intervalMs: 50,
      onCode,
      reader,
      schedule: scheduler.schedule,
      signal: controller.signal,
      video,
    })

    await scheduler.runNext()
    controller.abort()
    finish('3017624010701')
    await new Promise((resolve) => setImmediate(resolve))
    expect(onCode).not.toHaveBeenCalled()
    expect(scheduler.queue).toEqual([])
  })

  test('does not start when the signal has already aborted', async () => {
    const scheduler = fakeScheduler()
    const controller = new AbortController()
    controller.abort()
    const reader = readerOf('3017624010701')
    runScanLoop({ onCode: vi.fn(), reader, schedule: scheduler.schedule, signal: controller.signal, video })
    await scheduler.runNext()
    expect(reader.calls).toBe(0)
  })

  test('a frame that throws does not stop the loop', async () => {
    const scheduler = fakeScheduler()
    const reader = readerOf(new Error('decoder hiccup'), '96385074')
    const onCode = vi.fn()
    runScanLoop({ onCode, reader, schedule: scheduler.schedule, signal: new AbortController().signal, video })
    await scheduler.runNext()
    await scheduler.runNext()
    expect(onCode).toHaveBeenCalledWith('96385074')
  })

  test('never reads a frame while the previous one is still being read', async () => {
    const scheduler = fakeScheduler()
    let finish: (code: string | null) => void = () => {}
    let calls = 0
    const reader: BarcodeReader = {
      detect: () => {
        calls++
        return new Promise((resolve) => (finish = resolve))
      },
    }
    runScanLoop({
      onCode: vi.fn(),
      reader,
      schedule: scheduler.schedule,
      signal: new AbortController().signal,
      video,
    })
    await scheduler.runNext()
    expect(calls).toBe(1)
    expect(scheduler.queue).toEqual([])
    finish(null)
    await new Promise((resolve) => setImmediate(resolve))
    expect(scheduler.queue).toHaveLength(1)
    await scheduler.runNext()
    expect(calls).toBe(2)
  })
})
