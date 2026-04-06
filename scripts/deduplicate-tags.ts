#!/usr/bin/env tsx
/**
 * Find and remove duplicate tags.
 *
 * A "duplicate" is defined as two or more tags with the same tag name AND the same
 * start_time (and same end_time if present). When duplicates are found the script
 * keeps the oldest row (lowest id) and soft-deletes the rest via the REST API.
 *
 * Requires ~/.config/aurboda/config with AURBODA_BASE_URL and AURBODA_TOKEN.
 *
 * Usage (run from apps/backend/):
 *   pnpm exec tsx ../../scripts/deduplicate-tags.ts                  # dry-run (default)
 *   pnpm exec tsx ../../scripts/deduplicate-tags.ts --apply          # actually delete duplicates
 *   pnpm exec tsx ../../scripts/deduplicate-tags.ts --start 2026-01  # only scan from Jan 2026
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

// ── Config ───────────────────────────────────────────────────────────────────

const loadConfig = (): { baseUrl: string; token: string } => {
  const configPath = resolve(homedir(), '.config/aurboda/config')
  const content = readFileSync(configPath, 'utf-8')
  const vars: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const match = line.match(/^(\w+)=["']?(.+?)["']?$/)
    if (match) vars[match[1]] = match[2]
  }
  if (!vars.AURBODA_BASE_URL || !vars.AURBODA_TOKEN) {
    throw new Error(`Missing AURBODA_BASE_URL or AURBODA_TOKEN in ${configPath}`)
  }
  return { baseUrl: vars.AURBODA_BASE_URL, token: vars.AURBODA_TOKEN }
}

// ── API helpers ──────────────────────────────────────────────────────────────

const apiGet = async (baseUrl: string, token: string, path: string): Promise<unknown> => {
  const res = await fetch(`${baseUrl}/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`)
  return res.json()
}

const apiDelete = async (baseUrl: string, token: string, path: string): Promise<unknown> => {
  const res = await fetch(`${baseUrl}/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status} ${await res.text()}`)
  return res.json()
}

// ── Types ────────────────────────────────────────────────────────────────────

interface ApiTag {
  id: string
  source: string
  external_id?: string
  tag: string
  tag_key?: string
  start_time: string
  end_time?: string
}

// ── Duplicate detection ─────────────────────────────────────────────────────

/** Group tags by (tag, start_time, end_time) and return only groups with duplicates. */
const findDuplicateGroups = (tags: ApiTag[]): ApiTag[][] => {
  const groups = new Map<string, ApiTag[]>()
  for (const tag of tags) {
    const key = `${tag.tag}|${tag.start_time}|${tag.end_time ?? ''}`
    const group = groups.get(key)
    if (group) group.push(tag)
    else groups.set(key, [tag])
  }
  return [...groups.values()].filter((g) => g.length > 1)
}

/** Log and optionally delete duplicates in a group. Returns number of deletions. */
const processDuplicateGroup = async (
  group: ApiTag[],
  apply: boolean,
  baseUrl: string,
  token: string,
): Promise<number> => {
  const [keep, ...dupes] = group
  console.log(
    `🔁 "${keep.tag}" at ${keep.start_time} — ${group.length} copies (keeping ${keep.id}, deleting ${dupes.length})`,
  )

  for (const dupe of dupes) {
    if (apply) {
      await apiDelete(baseUrl, token, `/tags/id/${dupe.id}`)
      console.log(`  🗑️  Deleted ${dupe.id} (source: ${dupe.source})`)
    } else {
      console.log(`  ↳ would delete ${dupe.id} (source: ${dupe.source})`)
    }
  }

  return apply ? dupes.length : 0
}

// ── Main ─────────────────────────────────────────────────────────────────────

const main = async () => {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const startIdx = args.indexOf('--start')
  const scanStart = startIdx !== -1 && args[startIdx + 1] ? args[startIdx + 1] : '2020-01-01'

  const { baseUrl, token } = loadConfig()

  console.log(`🔍 Scanning for duplicate tags from ${scanStart}...`)
  if (!apply) console.log('📋 DRY RUN — pass --apply to actually delete duplicates\n')

  // Scan in monthly chunks to avoid huge responses
  const start = new Date(scanStart + 'T00:00:00Z')
  const now = new Date()
  let totalDuplicates = 0
  let totalDeleted = 0

  const cursor = new Date(start)
  while (cursor < now) {
    const chunkStart = cursor.toISOString()
    cursor.setMonth(cursor.getMonth() + 1)
    const chunkEnd = cursor < now ? cursor.toISOString() : now.toISOString()

    const response = (await apiGet(baseUrl, token, `/tags?start=${chunkStart}&end=${chunkEnd}`)) as {
      data: ApiTag[]
    }

    const duplicateGroups = findDuplicateGroups(response.data)
    for (const group of duplicateGroups) {
      totalDuplicates += group.length - 1
      totalDeleted += await processDuplicateGroup(group, apply, baseUrl, token)
    }
  }

  console.log(`\n✅ Done! Found ${totalDuplicates} duplicate(s).`)
  if (apply) {
    console.log(`🗑️  Deleted ${totalDeleted} duplicate tag(s).`)
  } else if (totalDuplicates > 0) {
    console.log('💡 Run with --apply to delete them.')
  }
}

main().catch((err) => {
  console.error('💥 Error:', err)
  process.exit(1)
})
