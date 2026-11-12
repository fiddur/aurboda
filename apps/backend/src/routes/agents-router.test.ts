import express from 'express'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import supertest from 'supertest'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { API_URL_PLACEHOLDER, createAgentsRouter, renderAgentScript } from './agents-router.ts'

const API_BASE = 'https://aurboda.example/api'

const app = express()
app.use(createAgentsRouter(`${API_BASE}/`))

const hasCommand = (name: string): boolean => spawnSync('sh', ['-c', `command -v ${name}`]).status === 0

const fetchScript = async (path: string): Promise<string> => (await supertest(app).get(path)).text

describe('GET /agents/activitywatch.sh', () => {
  test('serves the installer as a shell script with the API base filled in', async () => {
    const res = await supertest(app).get('/agents/activitywatch.sh')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('text/x-shellscript; charset=utf-8')
    expect(res.headers['cache-control']).toMatch(/max-age=300/)
    expect(res.text).toContain(`DEFAULT_URL='${API_BASE}'`)
    expect(res.text).toContain(`curl -fsSL ${API_BASE}/agents/activitywatch.sh`)
    expect(res.text).not.toContain(API_URL_PLACEHOLDER)
  })

  test('installs the same push agent docs/activitywatch.md gives for manual setup', async () => {
    const installed = (await fetchScript('/agents/activitywatch.sh'))
      .split("<<'AGENT_EOF'\n")[1]
      .split('\nAGENT_EOF\n')[0]
    const docs = readFileSync(new URL('../../../../docs/activitywatch.md', import.meta.url), 'utf8')

    expect(docs).toContain(`\`\`\`bash\n${installed}\n\`\`\``)
  })

  test.skipIf(!hasCommand('bash'))('renders a script bash can parse', async () => {
    const result = spawnSync('bash', ['-n'], { input: await fetchScript('/agents/activitywatch.sh') })

    expect(result.stderr.toString()).toBe('')
    expect(result.status).toBe(0)
  })
})

describe('GET /agents/activitywatch.ps1', () => {
  test('serves the installer as text with the API base filled in', async () => {
    const res = await supertest(app).get('/agents/activitywatch.ps1')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(res.headers['cache-control']).toMatch(/max-age=300/)
    expect(res.text).toContain(`$apiUrl = '${API_BASE}'`)
    expect(res.text).not.toContain(API_URL_PLACEHOLDER)
  })

  test('is plain ASCII, so Windows PowerShell 5.1 reads it the same under any code page', async () => {
    expect(await fetchScript('/agents/activitywatch.ps1')).not.toMatch(/[^\t\n\r -~]/)
  })

  test.skipIf(!hasCommand('pwsh'))(
    'renders a script PowerShell can parse',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'aw-ps1-'))
      try {
        const file = join(dir, 'activitywatch.ps1')
        writeFileSync(file, await fetchScript('/agents/activitywatch.ps1'))
        const check = `$errors = $null; [System.Management.Automation.Language.Parser]::ParseFile('${file}', [ref]$null, [ref]$errors) | Out-Null; if ($errors.Count) { $errors | ForEach-Object { $_.Message }; exit 1 }`
        const result = spawnSync('pwsh', ['-NoProfile', '-Command', check])

        expect(result.stdout.toString()).toBe('')
        expect(result.status).toBe(0)
      } finally {
        rmSync(dir, { force: true, recursive: true })
      }
    },
    60_000,
  )
})

describe('renderAgentScript', () => {
  test('replaces every placeholder and drops trailing slashes from the base', () => {
    expect(renderAgentScript(`a ${API_URL_PLACEHOLDER} b ${API_URL_PLACEHOLDER}/x`, 'https://h/api//')).toBe(
      'a https://h/api b https://h/api/x',
    )
  })
})

// Runs the real installer in a throwaway HOME. `crontab` and `systemctl` are stubs on PATH, so
// the run never touches the machine's own schedule: systemd reports no user session and the
// "crontab" lives in a file under the throwaway HOME.
describe.skipIf(!hasCommand('bash') || !hasCommand('python3') || !hasCommand('curl'))(
  'activitywatch.sh install and uninstall',
  () => {
    const root = mkdtempSync(join(tmpdir(), 'aw-install-'))
    const home = join(root, 'home')
    const stubs = join(root, 'stubs')
    const script = join(root, 'activitywatch.sh')

    const writeStub = (name: string, body: string) => {
      writeFileSync(join(stubs, name), `#!/usr/bin/env bash\n${body}\n`)
      chmodSync(join(stubs, name), 0o755)
    }

    beforeAll(async () => {
      mkdirSync(home, { recursive: true })
      mkdirSync(stubs, { recursive: true })
      writeStub('systemctl', 'exit 1')
      writeStub(
        'crontab',
        [
          'f="$HOME/fake-crontab"',
          'case "$1" in',
          '  -l) if [ -f "$f" ]; then cat "$f"; else exit 1; fi ;;',
          '  -) cat >"$f" ;;',
          'esac',
        ].join('\n'),
      )
      writeFileSync(script, await fetchScript('/agents/activitywatch.sh'))
    })

    afterAll(() => rmSync(root, { force: true, recursive: true }))

    const run = (...args: string[]) => {
      const result = spawnSync('bash', [script, ...args], {
        env: {
          HOME: home,
          PATH: `${stubs}:${process.env.PATH ?? '/usr/bin:/bin'}`,
        },
        timeout: 30_000,
      })
      return { output: `${result.stdout}${result.stderr}`, status: result.status }
    }

    const cronLines = () => {
      const file = join(home, 'fake-crontab')
      return existsSync(file)
        ? readFileSync(file, 'utf8')
            .split('\n')
            .filter((line) => line.includes('aw-aurboda'))
        : []
    }

    test('installs the agent with a private settings file and one schedule, and uninstalls it', () => {
      const first = run('--token', 'abc+/=-def-ghi', '--device', 'test box', '--url', 'http://127.0.0.1:9')
      expect(first.output).toContain('Installed the agent')
      expect(first.status).toBe(0)

      const env = join(home, '.config/aw-aurboda/env')
      expect(readFileSync(env, 'utf8')).toBe(
        'AURBODA_URL="http://127.0.0.1:9"\nAURBODA_TOKEN="abc+/=-def-ghi"\nDEVICE_NAME="test box"\n',
      )
      expect(statSync(env).mode & 0o777).toBe(0o600)
      expect(statSync(join(home, '.local/bin/aw-to-aurboda.sh')).mode & 0o111).not.toBe(0)
      expect(cronLines()).toHaveLength(1)
      expect(cronLines()[0]).not.toContain('abc+/=-def-ghi')

      expect(run('--token', 'abc+/=-def-ghi', '--url', 'http://127.0.0.1:9').status).toBe(0)
      expect(cronLines()).toHaveLength(1)

      const removed = run('--uninstall')
      expect(removed.status).toBe(0)
      expect(cronLines()).toHaveLength(0)
      expect(existsSync(join(home, '.local/bin/aw-to-aurboda.sh'))).toBe(false)
      expect(existsSync(join(home, '.config/aw-aurboda'))).toBe(false)
    })

    test('refuses to install without a token', () => {
      const result = run('--url', 'http://127.0.0.1:9')

      expect(result.status).toBe(1)
      expect(result.output).toContain('--token')
    })
  },
)
