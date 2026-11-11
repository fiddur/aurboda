import { describe, expect, test, vi } from 'vitest'

import type { FeedPostRecord } from '../../db/index.ts'

import { createPostUpdateResender } from './post-update-resend.ts'

const post = (id: string) => ({ id }) as FeedPostRecord

describe('createPostUpdateResender', () => {
  test('delivers each listed post of each user once and counts them', async () => {
    const deliver = vi.fn(async (_user: string, _post: FeedPostRecord) => undefined)
    const resender = createPostUpdateResender({
      deliver,
      listPosts: async (user) => (user === 'alice' ? [post('a1'), post('a2')] : [post('b1')]),
      listUsers: async () => ['alice', 'bob'],
    })
    const run = await resender.start()
    expect(run?.posts).toBe(3)
    await run?.done
    expect(deliver.mock.calls.map(([user, p]) => `${user}/${p.id}`)).toEqual([
      'alice/a1',
      'alice/a2',
      'bob/b1',
    ])
  })

  test('a failed delivery or listing costs no other post its Update', async () => {
    const deliver = vi.fn(async (_user: string, p: FeedPostRecord) => {
      if (p.id === 'a1') throw new Error('connect ECONNREFUSED')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const resender = createPostUpdateResender({
      deliver,
      listPosts: async (user) => {
        if (user === 'gone') throw new Error('database "gone" does not exist')
        return [post(`${user[0]}1`), post(`${user[0]}2`)]
      },
      listUsers: async () => ['alice', 'gone', 'bob'],
    })
    const run = await resender.start()
    expect(run?.posts).toBe(4)
    await expect(run?.done).resolves.toBeUndefined()
    expect(deliver).toHaveBeenCalledTimes(4)
    warn.mockRestore()
  })

  test('a delivery that hangs past the timeout counts as failed and the run moves on', async () => {
    const deliver = vi.fn((_user: string, p: FeedPostRecord) =>
      p.id === 'a1' ? new Promise<void>(() => undefined) : Promise.resolve(),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const run = await createPostUpdateResender({
      deliver,
      listPosts: async () => [post('a1'), post('a2')],
      listUsers: async () => ['alice'],
      timeoutMs: 10,
    }).start()
    await run?.done
    expect(deliver).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenLastCalledWith('📤 post Update re-send finished: 2 posts, 1 failed')
    warn.mockRestore()
    log.mockRestore()
  })

  test('refuses a second start while one is delivering, and runs again after', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const deliver = vi.fn(() => gate)
    const resender = createPostUpdateResender({
      deliver,
      listPosts: async () => [post('a1')],
      listUsers: async () => ['alice'],
    })
    const first = await resender.start()
    expect(await resender.start()).toBeNull()
    release()
    await first?.done
    const again = await resender.start()
    expect(again?.posts).toBe(1)
    await again?.done
    expect(deliver).toHaveBeenCalledTimes(2)
  })
})
