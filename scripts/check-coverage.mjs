#!/usr/bin/env node
/**
 * Local coverage gate — compares coverage-final.json against a committed baseline.
 *
 * Usage:
 *   node scripts/check-coverage.mjs <coverage-final.json> <baseline.json>
 *
 * Exits 0 if all metrics meet or exceed the baseline, 1 otherwise.
 * On success the baseline file is updated in-place so the next PR must
 * maintain (or improve) the new numbers.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [coveragePath, baselinePath] = process.argv.slice(2)

if (!coveragePath || !baselinePath) {
  console.error('Usage: check-coverage.mjs <coverage-final.json> <baseline.json>')
  process.exit(1)
}

const coverageFile = resolve(coveragePath)
const baselineFile = resolve(baselinePath)

// ---------------------------------------------------------------------------
// Parse Istanbul coverage-final.json
// ---------------------------------------------------------------------------
const data = JSON.parse(readFileSync(coverageFile, 'utf8'))

let totalStatements = 0,
  coveredStatements = 0
let totalBranches = 0,
  coveredBranches = 0
let totalFunctions = 0,
  coveredFunctions = 0

for (const cov of Object.values(data)) {
  for (const count of Object.values(cov.s)) {
    totalStatements++
    if (count > 0) coveredStatements++
  }
  for (const count of Object.values(cov.b)) {
    for (const c of Array.isArray(count) ? count : [count]) {
      totalBranches++
      if (c > 0) coveredBranches++
    }
  }
  for (const count of Object.values(cov.f)) {
    totalFunctions++
    if (count > 0) coveredFunctions++
  }
}

const pct = (n, d) => (d === 0 ? 100 : +((n / d) * 100).toFixed(2))

const current = {
  statements: pct(coveredStatements, totalStatements),
  branches: pct(coveredBranches, totalBranches),
  functions: pct(coveredFunctions, totalFunctions),
}

// ---------------------------------------------------------------------------
// Compare against baseline
// ---------------------------------------------------------------------------
const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'))

const metrics = ['statements', 'branches', 'functions']
const results = metrics.map((m) => ({
  metric: m,
  current: current[m],
  baseline: baseline[m],
  diff: +(current[m] - baseline[m]).toFixed(2),
  pass: current[m] >= baseline[m],
}))

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log('')
console.log('📊 Coverage Report')
console.log('─'.repeat(58))
console.log(
  'Metric'.padEnd(14),
  'Current'.padStart(10),
  'Baseline'.padStart(10),
  'Diff'.padStart(10),
  'Status'.padStart(10),
)
console.log('─'.repeat(58))

for (const r of results) {
  const icon = r.pass ? '✅' : '❌'
  const diffStr = (r.diff >= 0 ? '+' : '') + r.diff.toFixed(2) + '%'
  console.log(
    r.metric.padEnd(14),
    (r.current.toFixed(2) + '%').padStart(10),
    (r.baseline.toFixed(2) + '%').padStart(10),
    diffStr.padStart(10),
    icon.padStart(8),
  )
}
console.log('─'.repeat(58))

const allPass = results.every((r) => r.pass)

if (allPass) {
  console.log('✅ Coverage meets or exceeds baseline.')

  // Ratchet: update the baseline so it can only go up
  const newBaseline = {
    statements: current.statements,
    branches: current.branches,
    functions: current.functions,
  }
  writeFileSync(baselineFile, JSON.stringify(newBaseline, null, 2) + '\n')
  console.log('🔒 Baseline updated to current values.')
} else {
  console.log('❌ Coverage has decreased below baseline!')
  console.log('   Add tests to cover new or modified code.')
  process.exit(1)
}
