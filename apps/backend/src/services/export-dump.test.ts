import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { gunzipSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'

import type { SharedFoodItemEntity } from './central-food-items.ts'
import type { ExportTokens } from './export-token.ts'

import {
  createDumpExporter,
  createDumpLinkIssuer,
  type DumpExporter,
  type DumpProcess,
  dumpFileName,
  parsePgDumpMajor,
  pgDumpArgs,
  serverMajorFromVersionNum,
  type SpawnProcess,
  streamUserDump,
} from './export-dump.ts'

interface FakeProcess extends DumpProcess {
  emit: (event: string, ...args: unknown[]) => boolean
  stdout: PassThrough
  stderr: PassThrough
  killed: boolean
  exit: (code: number | null) => void
}

const fakeProcess = (): FakeProcess => {
  const emitter = new EventEmitter()
  const proc = Object.assign(emitter, {
    exit: (code: number | null) => {
      proc.stdout.end()
      proc.stderr.end()
      setImmediate(() => emitter.emit('close', code, null))
    },
    kill: () => {
      proc.killed = true
      return true
    },
    killed: false,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  })
  return proc
}

interface Call {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  proc: FakeProcess
}

const fakeSpawn = (onSpawn: (call: Call) => void = () => {}) => {
  const calls: Call[] = []
  const spawn: SpawnProcess = (command, args, env) => {
    const call = { args, command, env, proc: fakeProcess() }
    calls.push(call)
    onSpawn(call)
    return call.proc
  }
  return { calls, spawn }
}

const collector = () => {
  const chunks: Buffer[] = []
  const out = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk)
      callback()
    },
  })
  return { body: () => Buffer.concat(chunks), out }
}

const nextTick = () => new Promise((resolve) => setImmediate(resolve))

describe('pgDumpArgs', () => {
  test('dumps the user database as the user, without owners or privileges', () => {
    expect(pgDumpArgs('alice', { host: 'db', port: '5433', user: 'svc' })).toEqual([
      '--format=plain',
      '--no-owner',
      '--no-privileges',
      '--exclude-table-data=public.spatial_ref_sys',
      '--role=alice',
      '--dbname=aurboda_alice',
      '--host=db',
      '--port=5433',
      '--username=svc',
    ])
  })

  test('leaves out connection flags that are not set', () => {
    expect(pgDumpArgs('alice', {})).toEqual([
      '--format=plain',
      '--no-owner',
      '--no-privileges',
      '--exclude-table-data=public.spatial_ref_sys',
      '--role=alice',
      '--dbname=aurboda_alice',
    ])
  })
})

describe('version parsing', () => {
  test('reads the pg_dump major', () => {
    expect(parsePgDumpMajor('pg_dump (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)\n')).toBe(16)
    expect(parsePgDumpMajor('pg_dump (PostgreSQL) 17.2\n')).toBe(17)
    expect(parsePgDumpMajor('something else')).toBeNull()
  })

  test('reads the server major from server_version_num', () => {
    expect(serverMajorFromVersionNum('160004')).toBe(16)
    expect(serverMajorFromVersionNum(170002)).toBe(17)
  })
})

test('dumpFileName uses the UTC date', () => {
  expect(dumpFileName('alice', new Date('2026-11-06T23:30:00Z'))).toBe('aurboda-alice-2026-11-06.sql.gz')
})

describe('streamUserDump', () => {
  test('gzips pg_dump stdout into out and passes the password in the environment', async () => {
    const { calls, spawn } = fakeSpawn(({ proc }) => {
      setImmediate(() => {
        proc.stdout.write('CREATE TABLE t ();\n')
        proc.stdout.write('COPY t FROM stdin;\n')
        proc.exit(0)
      })
    })
    const { body, out } = collector()

    const result = await streamUserDump({
      conn: { host: 'db', password: 'secret', user: 'svc' },
      env: { PATH: '/bin' },
      out,
      spawn,
      user: 'alice',
    })

    expect(calls[0].command).toBe('pg_dump')
    expect(calls[0].args).toContain('--role=alice')
    expect(calls[0].env).toEqual({ PATH: '/bin', PGPASSWORD: 'secret' })
    expect(gunzipSync(body()).toString()).toBe('CREATE TABLE t ();\nCOPY t FROM stdin;\n')
    expect(result.bytes).toBe(body().length)
    expect(out.writableFinished).toBe(true)
  })

  test('appends the trailer after everything pg_dump wrote', async () => {
    const { spawn } = fakeSpawn(({ proc }) => {
      setImmediate(() => {
        proc.stdout.write('CREATE TABLE t ();\n')
        setImmediate(() => {
          proc.stdout.write('-- dump complete\n')
          proc.exit(0)
        })
      })
    })
    const { body, out } = collector()

    const result = await streamUserDump({ conn: {}, out, spawn, trailer: 'SELECT 1;\n', user: 'alice' })

    expect(gunzipSync(body()).toString()).toBe('CREATE TABLE t ();\n-- dump complete\nSELECT 1;\n')
    expect(result.bytes).toBe(body().length)
    expect(out.writableFinished).toBe(true)
  })

  test('a non-zero exit destroys out instead of ending it', async () => {
    const { spawn } = fakeSpawn(({ proc }) => {
      setImmediate(() => {
        proc.stdout.write('partial')
        proc.stderr.write('permission denied for table x')
        proc.exit(1)
      })
    })
    const { out } = collector()

    await expect(streamUserDump({ conn: {}, out, spawn, user: 'alice' })).rejects.toThrow(
      /exited with 1: permission denied for table x/,
    )
    expect(out.destroyed).toBe(true)
    expect(out.writableFinished).toBe(false)
  })

  test('a spawn error destroys out', async () => {
    const { spawn } = fakeSpawn(({ proc }) => {
      setImmediate(() =>
        proc.emit('error', Object.assign(new Error('spawn pg_dump ENOENT'), { code: 'ENOENT' })),
      )
    })
    const { out } = collector()

    await expect(streamUserDump({ conn: {}, out, spawn, user: 'alice' })).rejects.toThrow(/ENOENT/)
    expect(out.destroyed).toBe(true)
  })

  test('a client disconnect kills pg_dump', async () => {
    const { calls, spawn } = fakeSpawn()
    const { out } = collector()

    const done = streamUserDump({ conn: {}, out, spawn, user: 'alice' })
    calls[0].proc.stdout.write('some data')
    await nextTick()
    out.destroy()

    await expect(done).rejects.toThrow(/Client disconnected/)
    expect(calls[0].proc.killed).toBe(true)
  })
})

const versionSpawn = (versionOutput: string | Error, onDump: (call: Call) => void = () => {}) =>
  fakeSpawn((call) => {
    if (call.args[0] === '--version') {
      setImmediate(() => {
        if (versionOutput instanceof Error) {
          call.proc.emit('error', versionOutput)
          return
        }
        call.proc.stdout.write(versionOutput)
        call.proc.exit(0)
      })
      return
    }
    onDump(call)
  })

const enoent = () => Object.assign(new Error('spawn pg_dump ENOENT'), { code: 'ENOENT' })

describe('createDumpExporter', () => {
  const exporterWith = (spawn: SpawnProcess, serverVersion = '160004', exported: number[] = []) =>
    createDumpExporter({
      conn: {},
      onExported: async (_user, bytes) => {
        exported.push(bytes)
      },
      serverVersionNum: async () => serverVersion,
      sharedFoodItems: async () => [],
      spawn,
    })

  test('a missing pg_dump answers 503', async () => {
    const { spawn } = versionSpawn(enoent())
    expect(await exporterWith(spawn).check('alice')).toEqual({
      error: 'pg_dump is not installed on this server',
      ok: false,
      status: 503,
    })
  })

  test('a pg_dump older than the server answers 503 naming both versions', async () => {
    const { spawn } = versionSpawn('pg_dump (PostgreSQL) 15.4\n')
    const result = await exporterWith(spawn, '160004').check('alice')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(503)
    expect(result.error).toContain('pg_dump 15')
    expect(result.error).toContain('PostgreSQL 16')
  })

  test('a newer pg_dump is fine, and its version is looked up once', async () => {
    const { calls, spawn } = versionSpawn('pg_dump (PostgreSQL) 17.2\n')
    const exporter = exporterWith(spawn, '160004')
    expect(await exporter.check('alice')).toEqual({ ok: true })
    expect(await exporter.check('bob')).toEqual({ ok: true })
    expect(calls.filter((c) => c.args[0] === '--version')).toHaveLength(1)
  })

  test('a second export for the same user answers 409 until the first settles', async () => {
    let dump: FakeProcess | undefined
    const { spawn } = versionSpawn('pg_dump (PostgreSQL) 16.1\n', (call) => {
      dump = call.proc
    })
    const exported: number[] = []
    const exporter: DumpExporter = exporterWith(spawn, '160004', exported)

    const first = await exporter.start('alice')
    if (!first.ok) throw new Error('expected the first export to start')
    const { out } = collector()
    const running = first.run(out)

    expect(await exporter.start('alice')).toMatchObject({ ok: false, status: 409 })
    expect(await exporter.check('alice')).toMatchObject({ ok: false, status: 409 })
    expect(await exporter.check('bob')).toEqual({ ok: true })

    dump!.stdout.write('data')
    dump!.exit(0)
    await running
    expect(exported).toHaveLength(1)
    expect(await exporter.check('alice')).toEqual({ ok: true })
  })

  test('the same link requested again cancels the running export and takes over', async () => {
    const dumps: FakeProcess[] = []
    const { spawn } = versionSpawn('pg_dump (PostgreSQL) 16.1\n', (call) => dumps.push(call.proc))
    const exporter = exporterWith(spawn)

    const first = await exporter.start('alice', 'link-1')
    if (!first.ok) throw new Error('expected the first export to start')
    const firstOut = collector().out
    const firstRun = first.run(firstOut)

    expect(await exporter.start('alice', 'link-2')).toMatchObject({ ok: false, status: 409 })

    const second = await exporter.start('alice', 'link-1')
    await expect(firstRun).rejects.toThrow(/Client disconnected/)
    expect(firstOut.destroyed).toBe(true)
    expect(dumps[0].killed).toBe(true)
    if (!second.ok) throw new Error('expected the same link to take over')

    const secondRun = second.run(collector().out)
    await nextTick()
    dumps[1].stdout.write('data')
    dumps[1].exit(0)
    await expect(secondRun).resolves.toMatchObject({ bytes: expect.any(Number) })
  })

  test('a failed export frees the slot', async () => {
    const { spawn } = versionSpawn('pg_dump (PostgreSQL) 16.1\n', ({ proc }) => {
      setImmediate(() => proc.exit(1))
    })
    const exported: number[] = []
    const exporter = exporterWith(spawn, '160004', exported)

    const started = await exporter.start('alice')
    if (!started.ok) throw new Error('expected the export to start')
    await expect(started.run(collector().out)).rejects.toThrow(/exited with 1/)
    expect(exported).toHaveLength(0)
    expect(await exporter.check('alice')).toEqual({ ok: true })
  })

  test('a failed audit write after a complete dump still counts as a successful export', async () => {
    const { spawn } = versionSpawn('pg_dump (PostgreSQL) 16.1\n', ({ proc }) => {
      setImmediate(() => {
        proc.stdout.write('data')
        proc.exit(0)
      })
    })
    const exporter = createDumpExporter({
      conn: {},
      onExported: async () => {
        throw new Error('audit log unavailable')
      },
      serverVersionNum: async () => '160004',
      sharedFoodItems: async () => [],
      spawn,
    })

    const started = await exporter.start('alice')
    if (!started.ok) throw new Error('expected the export to start')
    await expect(started.run(collector().out)).resolves.toMatchObject({ bytes: expect.any(Number) })
    expect(await exporter.check('alice')).toEqual({ ok: true })
  })

  const sharedItem = (overrides: Partial<SharedFoodItemEntity> = {}): SharedFoodItemEntity => ({
    calories: 52,
    created_at: new Date('2026-01-02T03:04:05Z'),
    default_quantity: 100,
    default_unit: 'g',
    id: '11111111-1111-4111-8111-111111111111',
    name: "Bob's apple",
    name_lower: "bob's apple",
    source: 'livsmedelsverket',
    source_id: '42',
    updated_at: new Date('2026-01-02T03:04:05Z'),
    ...overrides,
  })

  const exportWithShared = async (load: () => Promise<SharedFoodItemEntity[]>) => {
    const { spawn } = versionSpawn('pg_dump (PostgreSQL) 16.1\n', ({ proc }) => {
      setImmediate(() => {
        proc.stdout.write('-- PostgreSQL database dump complete\n')
        proc.exit(0)
      })
    })
    const exporter = createDumpExporter({
      conn: {},
      onExported: async () => {},
      serverVersionNum: async () => '160004',
      sharedFoodItems: load,
      spawn,
    })
    const started = await exporter.start('alice')
    if (!started.ok) throw new Error('expected the export to start')
    const { body, out } = collector()
    return { body, out, run: started.run(out) }
  }

  test('appends the referenced shared food items after the dump, quoting their values', async () => {
    const { body, run } = await exportWithShared(async () => [sharedItem()])
    await run

    const sql = gunzipSync(body()).toString()
    expect(sql.startsWith('-- PostgreSQL database dump complete\n')).toBe(true)
    const trailer = sql.slice('-- PostgreSQL database dump complete\n'.length)
    expect(trailer).toContain('CREATE TABLE IF NOT EXISTS public.exported_shared_food_items (')
    expect(trailer).toContain('INSERT INTO public.exported_shared_food_items (id, name, name_lower, source')
    expect(trailer).toContain("'11111111-1111-4111-8111-111111111111', 'Bob''s apple', 'bob''s apple'")
    expect(trailer).toContain("'2026-01-02T03:04:05.000Z'")
    expect(trailer).toContain('ON CONFLICT (id) DO NOTHING;')
  })

  test('writes no trailer when the data references no shared food items', async () => {
    const { body, run } = await exportWithShared(async () => [])
    await run
    expect(gunzipSync(body()).toString()).toBe('-- PostgreSQL database dump complete\n')
  })

  test('a failed shared food lookup fails the export and destroys out', async () => {
    const { out, run } = await exportWithShared(async () => {
      throw new Error('central database unavailable')
    })
    await expect(run).rejects.toThrow(/central database unavailable/)
    expect(out.destroyed).toBe(true)
  })
})

describe('createDumpLinkIssuer', () => {
  const tokens: ExportTokens = {
    createExportToken: (user) => ({ expires_at: new Date('2026-11-06T12:10:00Z'), token: `tok+${user}/=` }),
    spendExportToken: () => {},
    verifyExportToken: () => null,
  }

  test('builds an absolute API URL carrying the encoded token', async () => {
    const exporter: DumpExporter = {
      check: async () => ({ ok: true }),
      start: async () => ({ error: 'unused', ok: false, status: 503 }),
    }
    const issue = createDumpLinkIssuer({ apiBaseUrl: 'https://example.net/api/', exporter, tokens })
    expect(await issue('alice')).toEqual({
      expires_at: new Date('2026-11-06T12:10:00Z'),
      ok: true,
      url: 'https://example.net/api/export/dump?token=tok%2Balice%2F%3D',
    })
  })

  test('passes on a failed check without issuing a token', async () => {
    const exporter: DumpExporter = {
      check: async () => ({ error: 'pg_dump is not installed on this server', ok: false, status: 503 }),
      start: async () => ({ error: 'unused', ok: false, status: 503 }),
    }
    const issue = createDumpLinkIssuer({ apiBaseUrl: 'https://example.net/api', exporter, tokens })
    expect(await issue('alice')).toEqual({
      error: 'pg_dump is not installed on this server',
      ok: false,
      status: 503,
    })
  })
})
