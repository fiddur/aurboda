import { spawn as nodeSpawn } from 'node:child_process'
import { type Readable, Transform, type Writable } from 'node:stream'
import { createGzip } from 'node:zlib'

import type { SharedFoodItemEntity } from './central-food-items.ts'
import type { ExportTokens } from './export-token.ts'

import { query, userDbName } from '../db/index.ts'
import { auditInfo } from './audit-log.ts'
import { exportedSharedFoodTrailer, loadReferencedSharedFoodItems } from './exported-shared-food.ts'

export interface PgConnection {
  host?: string
  port?: string
  user?: string
  password?: string
}

export interface DumpProcess {
  stdout: Readable
  stderr: Readable
  kill: (signal?: NodeJS.Signals) => boolean
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
}

export type SpawnProcess = (command: string, args: string[], env: NodeJS.ProcessEnv) => DumpProcess

const defaultSpawn: SpawnProcess = (command, args, env) =>
  nodeSpawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })

export const connectionFromEnv = (env: NodeJS.ProcessEnv = process.env): PgConnection => ({
  host: env.PGHOST,
  password: env.PGPASSWORD,
  port: env.PGPORT,
  user: env.PGUSER,
})

/**
 * `--role` makes pg_dump `SET ROLE` to the user after connecting as the service role, so it
 * reads exactly what the user can; `--no-owner --no-privileges` leave ownership to whoever
 * restores it, so the dump restores under any role name. `spatial_ref_sys` belongs to PostGIS,
 * which fills it on `CREATE EXTENSION`; its rows in a dump would only fail to restore as the user.
 */
export const pgDumpArgs = (user: string, conn: PgConnection): string[] => [
  '--format=plain',
  '--no-owner',
  '--no-privileges',
  '--exclude-table-data=public.spatial_ref_sys',
  `--role=${user}`,
  `--dbname=${userDbName(user)}`,
  ...(conn.host ? [`--host=${conn.host}`] : []),
  ...(conn.port ? [`--port=${conn.port}`] : []),
  ...(conn.user ? [`--username=${conn.user}`] : []),
]

const dumpEnv = (conn: PgConnection, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  conn.password === undefined ? { ...base } : { ...base, PGPASSWORD: conn.password }

export const dumpFileName = (user: string, now: Date): string =>
  `aurboda-${user}-${now.toISOString().slice(0, 10)}.sql.gz`

const MAX_STDERR = 64 * 1024

/**
 * Pipe `pg_dump` of the user's database through gzip into `out`, followed by `trailer` once
 * pg_dump's output has ended. `out` is ended only once pg_dump has exited 0; any failure
 * destroys it instead, so a broken dump never looks like a complete file. A premature close
 * of `out` (the client went away) kills pg_dump and rejects.
 */
export const streamUserDump = ({
  conn = connectionFromEnv(),
  env = process.env,
  out,
  spawn = defaultSpawn,
  trailer = '',
  user,
}: {
  user: string
  out: Writable
  spawn?: SpawnProcess
  trailer?: string
  conn?: PgConnection
  env?: NodeJS.ProcessEnv
}): Promise<{ bytes: number }> =>
  new Promise((resolve, reject) => {
    const child = spawn('pg_dump', pgDumpArgs(user, conn), dumpEnv(conn, env))
    const gzip = createGzip()
    let bytes = 0
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length
        callback(null, chunk)
      },
    })
    let stderr = ''
    let compressed = false
    let exit: { code: number | null; signal: NodeJS.Signals | null } | null = null
    let settled = false

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      gzip.destroy()
      out.destroy(error)
      reject(error)
    }

    const finishWhenDone = () => {
      if (settled || !compressed || !exit) return
      if (exit.code !== 0) {
        fail(new Error(`pg_dump exited with ${exit.code ?? exit.signal}: ${stderr.trim()}`))
        return
      }
      settled = true
      out.end(() => resolve({ bytes }))
    }

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR) stderr += chunk.toString('utf8')
    })
    child.on('error', fail)
    child.on('close', (code, signal) => {
      exit = { code, signal }
      finishWhenDone()
    })
    gzip.on('error', fail)
    counter.on('error', fail)
    counter.on('end', () => {
      compressed = true
      finishWhenDone()
    })
    out.on('error', fail)
    out.on('close', () => fail(new Error('Client disconnected before the export finished')))

    child.stdout.on('end', () => {
      if (trailer) gzip.end(trailer)
      else gzip.end()
    })
    child.stdout.pipe(gzip, { end: false })
    gzip.pipe(counter).pipe(out, { end: false })
  })

export const parsePgDumpMajor = (versionOutput: string): number | null => {
  const match = /\(PostgreSQL\)\s+(\d+)/.exec(versionOutput)
  return match ? Number(match[1]) : null
}

export const serverMajorFromVersionNum = (versionNum: string | number): number =>
  Math.floor(Number(versionNum) / 10000)

const runForOutput = (spawn: SpawnProcess, command: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, process.env)
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
    })
    child.stderr.resume()
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(output)
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`))
    })
  })

const isNotFound = (error: unknown): boolean =>
  error instanceof Error && (error as Error & { code?: string }).code === 'ENOENT'

export type ExportCheck = { ok: true } | { ok: false; status: 409 | 503; error: string }

export interface DumpExporterDeps {
  spawn?: SpawnProcess
  conn?: PgConnection
  /** `SHOW server_version_num` as seen by the user's database. */
  serverVersionNum?: (user: string) => Promise<string>
  onExported?: (user: string, bytes: number) => Promise<void>
  /** The server-library food items the user's data references, appended to the dump. */
  sharedFoodItems?: (user: string) => Promise<SharedFoodItemEntity[]>
}

export interface DumpExporter {
  /** Whether an export for the user could start now, without reserving anything. */
  check: (user: string) => Promise<ExportCheck>
  /**
   * Check, then reserve the user's single export slot until the returned `run` settles. A start
   * with the same `link` as the running export (the same download URL requested again) cancels
   * that export and takes its place: Android's WebView opens the URL and aborts it once it sees
   * the headers, then DownloadManager requests it again, possibly before the abort has landed.
   */
  start: (
    user: string,
    link?: string,
  ) => Promise<
    | { ok: false; status: 409 | 503; error: string }
    | { ok: true; run: (out: Writable) => Promise<{ bytes: number }> }
  >
}

const defaultServerVersionNum = async (user: string): Promise<string> =>
  (await query<{ server_version_num: string }>(user, 'SHOW server_version_num')).rows[0].server_version_num

interface RunningExport {
  link: string | undefined
  cancel: () => void
  done: Promise<void>
}

const ALREADY_RUNNING = { error: 'An export is already running', ok: false, status: 409 } as const

export const createDumpExporter = ({
  conn,
  onExported = (user, bytes) => auditInfo(user, 'data', 'Exported database dump', { bytes }),
  serverVersionNum = defaultServerVersionNum,
  sharedFoodItems = (user) => loadReferencedSharedFoodItems(user),
  spawn = defaultSpawn,
}: DumpExporterDeps = {}): DumpExporter => {
  const running = new Map<string, RunningExport>()
  let clientMajor: number | null = null

  const pgDumpMajor = async (): Promise<number> => {
    if (clientMajor !== null) return clientMajor
    const output = await runForOutput(spawn, 'pg_dump', ['--version'])
    const major = parsePgDumpMajor(output)
    if (major === null) throw new Error(`Unrecognised pg_dump --version output: ${output.trim()}`)
    clientMajor = major
    return major
  }

  const checkTools = async (user: string): Promise<ExportCheck> => {
    let client: number
    try {
      client = await pgDumpMajor()
    } catch (error) {
      if (isNotFound(error)) {
        return { error: 'pg_dump is not installed on this server', ok: false, status: 503 }
      }
      console.error('⚠️ pg_dump version check failed:', error)
      return { error: 'pg_dump could not be run on this server', ok: false, status: 503 }
    }
    const server = serverMajorFromVersionNum(await serverVersionNum(user))
    if (client < server) {
      return {
        error: `pg_dump ${client} is older than the database server (PostgreSQL ${server}); the server needs a PostgreSQL ${server} client`,
        ok: false,
        status: 503,
      }
    }
    return { ok: true }
  }

  return {
    check: async (user) => (running.has(user) ? ALREADY_RUNNING : checkTools(user)),
    start: async (user, link) => {
      const current = running.get(user)
      if (current) {
        if (link === undefined || current.link !== link) return ALREADY_RUNNING
        current.cancel()
        await current.done
      }
      const tools = await checkTools(user)
      if (!tools.ok) return tools
      if (running.has(user)) return ALREADY_RUNNING

      let cancel = () => {}
      let settle = () => {}
      const entry: RunningExport = {
        cancel: () => cancel(),
        done: new Promise<void>((resolve) => {
          settle = resolve
        }),
        link,
      }
      running.set(user, entry)
      return {
        ok: true,
        run: async (out) => {
          cancel = () => out.destroy()
          try {
            let trailer: string
            try {
              trailer = exportedSharedFoodTrailer(await sharedFoodItems(user))
            } catch (error) {
              out.destroy()
              throw error
            }
            if (out.destroyed) throw new Error('Client disconnected before the export finished')
            const result = await streamUserDump({ conn, out, spawn, trailer, user })
            // The dump reached the user: a failed audit write must not unspend the link.
            await onExported(user, result.bytes).catch((error: unknown) =>
              console.error(`⚠️ Recording the database export for ${user} failed:`, error),
            )
            return result
          } finally {
            if (running.get(user) === entry) running.delete(user)
            settle()
          }
        },
      }
    },
  }
}

export type DumpLinkResult =
  | { ok: false; status: 409 | 503; error: string }
  | { ok: true; url: string; expires_at: Date }

/** Shared by `POST /export/dump-link` and the `export_data_dump` MCP tool. */
export const createDumpLinkIssuer =
  ({ apiBaseUrl, exporter, tokens }: { apiBaseUrl: string; exporter: DumpExporter; tokens: ExportTokens }) =>
  async (user: string): Promise<DumpLinkResult> => {
    const check = await exporter.check(user)
    if (!check.ok) return check
    const { expires_at, token } = tokens.createExportToken(user)
    const base = apiBaseUrl.replace(/\/+$/, '')
    return { expires_at, ok: true, url: `${base}/export/dump?token=${encodeURIComponent(token)}` }
  }

export type DumpLinkIssuer = ReturnType<typeof createDumpLinkIssuer>
