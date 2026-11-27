import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import format from 'pg-format'
import { afterAll, beforeAll, describe, expect, inject, test } from 'vitest'

import { listUserNames, userDbName, userExists } from './connection.ts'

describe('userExists', () => {
  const user = `exists_${randomBytes(4).toString('hex')}`
  let admin: Client

  beforeAll(async () => {
    admin = new Client({ connectionString: inject('pgAdminUri') })
    await admin.connect()
    await admin.query(format('CREATE DATABASE %I', userDbName(user)))
  })

  afterAll(async () => {
    await admin.query(format('DROP DATABASE IF EXISTS %I', userDbName(user)))
    await admin.end()
  })

  test('is true for a user with a per-user database, as listUserNames lists it', async () => {
    expect(await listUserNames(admin)).toContain(user)
    expect(await userExists(admin, user)).toBe(true)
  })

  test('is false for a name with no per-user database', async () => {
    expect(await userExists(admin, `missing_${randomBytes(4).toString('hex')}`)).toBe(false)
  })

  test('compares the name exactly, as listUserNames(...).includes does', async () => {
    expect(await userExists(admin, user.toUpperCase())).toBe(false)
    expect(await userExists(admin, user.slice(0, -1))).toBe(false)
    expect(await userExists(admin, `${user}x`)).toBe(false)
  })
})
