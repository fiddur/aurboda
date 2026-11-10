import { describe, expect, test } from 'vitest'

import { createLatestWinsSaver } from './latestWinsSaver'

interface Pending {
  value: string
  resolve: (result: string) => void
  reject: (error: unknown) => void
}

const setup = () => {
  const calls: Pending[] = []
  const idle: string[] = []
  const errors: unknown[] = []
  const saver = createLatestWinsSaver<string, string>(
    (value) =>
      new Promise<string>((resolve, reject) => {
        calls.push({ reject, resolve, value })
      }),
    { onError: (error) => errors.push(error), onIdle: (last) => idle.push(last) },
  )
  return { calls, errors, idle, saver }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createLatestWinsSaver', () => {
  test('saves one value and reports idle with its result', async () => {
    const { calls, errors, idle, saver } = setup()
    saver.submit('a')
    expect(saver.isBusy()).toBe(true)
    await flush()
    expect(calls.map((c) => c.value)).toEqual(['a'])

    calls[0].resolve('saved-a')
    await flush()
    expect(idle).toEqual(['saved-a'])
    expect(errors).toEqual([])
    expect(saver.isBusy()).toBe(false)
  })

  test('saves sequential submits one after another', async () => {
    const { calls, idle, saver } = setup()
    saver.submit('a')
    await flush()
    calls[0].resolve('saved-a')
    await flush()
    saver.submit('b')
    await flush()
    calls[1].resolve('saved-b')
    await flush()
    expect(calls.map((c) => c.value)).toEqual(['a', 'b'])
    expect(idle).toEqual(['saved-a', 'saved-b'])
  })

  test('coalesces submits during a flight into one save of the latest value', async () => {
    const { calls, idle, saver } = setup()
    saver.submit('a')
    await flush()
    saver.submit('b')
    saver.submit('c')
    saver.submit('d')
    await flush()
    expect(calls.map((c) => c.value)).toEqual(['a'])

    calls[0].resolve('saved-a')
    await flush()
    expect(calls.map((c) => c.value)).toEqual(['a', 'd'])
    expect(idle).toEqual([])
    expect(saver.isBusy()).toBe(true)

    calls[1].resolve('saved-d')
    await flush()
    expect(calls).toHaveLength(2)
    expect(idle).toEqual(['saved-d'])
    expect(saver.isBusy()).toBe(false)
  })

  test('a failed save reports the error, drops the queue and becomes idle', async () => {
    const { calls, errors, idle, saver } = setup()
    saver.submit('a')
    await flush()
    saver.submit('b')
    calls[0].reject(new Error('boom'))
    await flush()
    expect(errors).toEqual([new Error('boom')])
    expect(calls).toHaveLength(1)
    expect(idle).toEqual([])
    expect(saver.isBusy()).toBe(false)

    saver.submit('c')
    await flush()
    expect(calls.map((c) => c.value)).toEqual(['a', 'c'])
  })

  test('a save that throws synchronously is reported as an error', async () => {
    const errors: unknown[] = []
    const saver = createLatestWinsSaver<string, string>(
      () => {
        throw new Error('sync')
      },
      { onError: (error) => errors.push(error), onIdle: () => undefined },
    )
    saver.submit('a')
    await flush()
    expect(errors).toEqual([new Error('sync')])
    expect(saver.isBusy()).toBe(false)
  })
})
