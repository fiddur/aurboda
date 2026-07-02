/**
 * Markdown doc generator.
 *
 * Regenerates the data-source tables in `README.md` and `docs/data-sources.md`
 * from the single `dataSources` catalog, so the docs cannot drift from the web
 * landing page (which renders the same catalog).
 *
 * Run with: pnpm generate:docs
 *
 * Each generated block is delimited by:
 *   <!-- BEGIN:data-sources -->  ... generated table ...  <!-- END:data-sources -->
 * Content between the markers is replaced; everything else is left untouched.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import { type DataSourceInfo, dataSources } from './data-sources.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const BEGIN = '<!-- BEGIN:data-sources -->'
const END = '<!-- END:data-sources -->'

/** Escape pipes so cell content can't break the markdown table. */
const cell = (value: string): string => value.replaceAll('|', '\\|')

/** Render the source name, linked to its docs page if `docLinkBase` is given. */
function sourceCell(source: DataSourceInfo, docLinkBase: string | null): string {
  if (docLinkBase && source.doc) {
    return `[**${cell(source.name)}**](${docLinkBase}${source.doc})`
  }
  return `**${cell(source.name)}**`
}

function markdownTable(rows: string[][]): string {
  const widths = rows[0].map((_, col) => Math.max(...rows.map((row) => row[col].length)))
  const pad = (row: string[]) => `| ${row.map((c, i) => c.padEnd(widths[i])).join(' | ')} |`
  const header = pad(rows[0])
  const sep = `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`
  const body = rows.slice(1).map(pad).join('\n')
  return `${header}\n${sep}\n${body}`
}

/** README table: Source | What it provides | How, with docs linked as `docs/<slug>`. */
function readmeTable(): string {
  const rows = [['Source', 'What it provides', 'How']]
  for (const s of dataSources) {
    rows.push([sourceCell(s, 'docs/'), cell(s.provides), cell(s.how)])
  }
  return markdownTable(rows)
}

/** docs/data-sources.md table: adds Admin/User setup, docs linked as `./<slug>`. */
function dataSourcesDocTable(): string {
  const rows = [['Source', 'Data Types', 'Sync Method', 'Admin Setup', 'User Setup']]
  for (const s of dataSources) {
    rows.push([
      sourceCell(s, './'),
      cell(s.provides),
      cell(s.how),
      cell(s.adminSetup ?? 'None'),
      cell(s.userSetup ?? '—'),
    ])
  }
  return markdownTable(rows)
}

function replaceBlock(filePath: string, table: string): void {
  const original = fs.readFileSync(filePath, 'utf8')
  const begin = original.indexOf(BEGIN)
  const end = original.indexOf(END)
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(`Missing ${BEGIN} / ${END} markers in ${filePath}`)
  }
  const before = original.slice(0, begin + BEGIN.length)
  const after = original.slice(end)
  const updated = `${before}\n\n${table}\n\n${after}`
  if (updated !== original) {
    fs.writeFileSync(filePath, updated)
    console.info(`Updated ${path.relative(repoRoot, filePath)}`)
  } else {
    console.info(`Unchanged ${path.relative(repoRoot, filePath)}`)
  }
}

replaceBlock(path.join(repoRoot, 'README.md'), readmeTable())
replaceBlock(path.join(repoRoot, 'docs/data-sources.md'), dataSourcesDocTable())
