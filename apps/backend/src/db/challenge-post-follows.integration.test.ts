import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { getChallengePostFollows, setChallengePostFollow } from './challenge-post-follows.ts'

const CONTAINER_TIMEOUT = 120_000
const A = 'https://host.example/users/freja/feed/a'
const B = 'https://host.example/users/freja/feed/b'

describe('challenge post follows (integration)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('no choice stored reads as absent', async () => {
    expect(await getChallengePostFollows(getTestUser(), [A, B])).toEqual(new Map())
    expect(await getChallengePostFollows(getTestUser(), [])).toEqual(new Map())
  })

  test('a choice is stored, read back and overwritten', async () => {
    const user = getTestUser()
    await setChallengePostFollow(user, A, false)
    await setChallengePostFollow(user, B, true)
    expect(await getChallengePostFollows(user, [A, B, A])).toEqual(
      new Map([
        [A, false],
        [B, true],
      ]),
    )
    await setChallengePostFollow(user, A, true)
    expect(await getChallengePostFollows(user, [A])).toEqual(new Map([[A, true]]))
  })
})
