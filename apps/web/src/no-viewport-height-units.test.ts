import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const srcDir = fileURLToPath(new URL('.', import.meta.url))

const viewportHeightUnit = /\b\d*\.?\d+(vh|dvh|svh|lvh)\b/

const allowlist: Record<string, string> = {
  'style.css': 'root heights; the native viewport fix pins <html> in px and overrides them',
  'components/Sidebar.css': 'the sidebar is hidden in embed mode',
  'pages/Meals/style.css': 'inside @media (min-width: 900px), never a phone',
  'pages/Meals/MealDetail.css': 'inside @media (min-width: 900px), never a phone',
}

const cssFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return cssFiles(path)
    return entry.name.endsWith('.css') ? [path] : []
  })

describe('web CSS', () => {
  it('uses no viewport-height units outside the allowlist', () => {
    const offenders = cssFiles(srcDir)
      .map((path) => relative(srcDir, path).split('\\').join('/'))
      .filter((file) => !(file in allowlist))
      .flatMap((file) =>
        readFileSync(join(srcDir, file), 'utf8')
          .split('\n')
          .flatMap((line, i) => (viewportHeightUnit.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [])),
      )

    expect(
      offenders,
      'The Android WebView resolves vh units to 0; size from % or flex instead (see docs/android-app.md, "Page height and vh units").',
    ).toEqual([])
  })

  it('allowlists only files that exist and still use viewport-height units', () => {
    const files = new Set(cssFiles(srcDir).map((path) => relative(srcDir, path).split('\\').join('/')))
    const stale = Object.keys(allowlist).filter(
      (file) => !files.has(file) || !viewportHeightUnit.test(readFileSync(join(srcDir, file), 'utf8')),
    )
    expect(stale).toEqual([])
  })
})
