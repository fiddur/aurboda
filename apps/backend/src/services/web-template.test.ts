import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createTemplateLoader } from './web-template.ts'

describe('createTemplateLoader', () => {
  let dir: string
  let indexPath: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'web-template-'))
    indexPath = join(dir, 'index.html')
    await writeFile(indexPath, '<html><title>Aurboda</title></html>')
  })

  afterAll(async () => {
    await rm(dir, { recursive: true })
  })

  test('returns null when no path is configured', async () => {
    expect(await createTemplateLoader(undefined)()).toBeNull()
  })

  test('returns null when the file cannot be read', async () => {
    expect(await createTemplateLoader(join(dir, 'missing.html'))()).toBeNull()
  })

  test('reads the template and caches it across calls', async () => {
    const load = createTemplateLoader(indexPath)
    const first = await load()
    expect(first).toContain('<title>Aurboda</title>')
    // Overwriting the file does not change the cached result.
    await writeFile(indexPath, '<html><title>Changed</title></html>')
    expect(await load()).toBe(first)
  })
})
