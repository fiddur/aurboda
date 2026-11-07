import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const srcDir = fileURLToPath(new URL('.', import.meta.url))

const brandPurple = /#673ab8|rgba\(\s*103,\s*58,\s*184/i

const isTest = (name: string): boolean => /\.test\.tsx?$/.test(name)

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(css|tsx?)$/.test(entry.name) && !isTest(entry.name) ? [path] : []
  })

describe('web colours', () => {
  it('uses no literal brand purple', () => {
    const offenders = sourceFiles(srcDir).flatMap((path) => {
      const file = relative(srcDir, path).split('\\').join('/')
      return readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, i) => (brandPurple.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : []))
    })

    expect(
      offenders,
      'Use the colour tokens in style.css (or CHART_PRIMARY from theme.ts for charts); see docs/web-theme.md.',
    ).toEqual([])
  })
})
