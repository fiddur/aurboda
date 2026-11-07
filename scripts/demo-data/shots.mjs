#!/usr/bin/env node
// Screenshots of the seeded demo world (see seed.mjs), light and dark, for the
// welcome page.
//
//   node scripts/demo-data/shots.mjs <out-dir> [--base http://localhost:8080] [--only a,b]
//
// Browse the app on its own origin (`WEB_HOST`, http://localhost:8080 for the
// tryout rig) so the links it builds for itself resolve.

import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium, devices } = require('playwright')

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : args.splice(i, 2)[1]
}
const BASE = (flag('base') ?? 'http://localhost:8080').replace(/\/+$/, '')
// Pages may come from a different origin than the API, e.g. a local vite dev server built from the working tree.
const WEB = (flag('web') ?? BASE).replace(/\/+$/, '')
const ONLY = flag('only')?.split(',')
const THEMES = flag('themes')?.split(',') ?? ['light', 'dark']
const OUT = args[0]
if (!OUT) {
  console.error('usage: shots.mjs <out-dir> [--base url] [--only name,…] [--themes light,dark]')
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })

const PASSWORD = process.env.DEMO_PASSWORD ?? 'demo-password-2026'
const TZ = 'Europe/Stockholm'
const DESKTOP = { height: 900, width: 1440 }

const api = async (path, { token, method = 'GET', body } = {}) => {
  const res = await fetch(`${BASE}/api${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    method,
  })
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

const login = async (username) =>
  (await api('/login', { body: { password: PASSWORD, username }, method: 'POST' })).token

const localDayKey = (instant) =>
  new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: TZ,
    year: 'numeric',
  }).format(new Date(instant))

const localHour = (instant) =>
  Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: TZ }).format(
      new Date(instant),
    ),
  )

/** The newest day before today with an evening run and no drinks: the day the day views show. */
const pickShowcaseDay = async (token) => {
  const end = new Date().toISOString()
  const start = new Date(Date.now() - 14 * 86_400_000).toISOString()
  const { data } = await api(`/activities?start=${start}&end=${end}&types=running,alcohol`, { token })
  const today = localDayKey(Date.now())
  const drinkDays = new Set(
    data.filter((a) => a.activity_type === 'alcohol').map((a) => localDayKey(Date.parse(a.start_time))),
  )
  const runs = data
    .filter((a) => a.activity_type === 'running' && localHour(Date.parse(a.start_time)) >= 16)
    .map((a) => ({ day: localDayKey(Date.parse(a.start_time)), run: a }))
    .filter(({ day }) => day < today && !drinkDays.has(day))
    .sort((a, b) => b.run.start_time.localeCompare(a.run.start_time))
  if (!runs.length) throw new Error('no evening run in the last two weeks — was the stack seeded?')
  return runs[0]
}

/** Midnight-to-midnight in Stockholm, as ISO instants. */
const dayWindow = (dayKey) => {
  const probe = new Date(`${dayKey}T12:00:00Z`)
  const offsetH =
    Number(
      new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: TZ }).format(probe),
    ) - 12
  const from = new Date(Date.parse(`${dayKey}T00:00:00Z`) - offsetH * 3_600_000)
  return { from: from.toISOString(), to: new Date(from.getTime() + 86_400_000 - 1).toISOString() }
}

/** Hover the middle of an activity on the horizontal timeline so its detail tooltip opens. */
const hoverActivity = async (page, activity) => {
  const mid = (Date.parse(activity.start_time) + Date.parse(activity.end_time)) / 2
  const point = await page.evaluate((t) => {
    const ticks = [...document.querySelectorAll('g.tick')]
      .filter((g) => g.__data__ instanceof Date)
      .map((g) => {
        const r = g.getBoundingClientRect()
        return { t: g.__data__.getTime(), x: r.x + r.width / 2 }
      })
    if (ticks.length < 2) return null
    const [a, b] = [ticks[0], ticks.at(-1)]
    const x = a.x + ((t - a.t) / (b.t - a.t)) * (b.x - a.x)
    for (let y = 60; y < 700; y += 3) {
      const hit = document
        .elementsFromPoint(x, y)
        .find((e) => e.tagName === 'rect' && e.getBoundingClientRect().height > 15)
      if (hit) {
        const r = hit.getBoundingClientRect()
        return { x, y: r.y + r.height / 2 }
      }
    }
    return null
  }, mid)
  if (!point) throw new Error('could not find the activity on the timeline')
  await page.mouse.move(point.x, point.y)
  await page.waitForTimeout(600)
}

/** Drive the Correlations → Explore form: a continuous, next-day comparison. */
const runExplore = async (page, trigger, outcome) => {
  await page.goto(`${WEB}/correlations`)
  await settle(page, 500)
  await page.getByRole('button', { exact: true, name: 'Explore' }).click()
  await page.getByRole('button', { exact: true, name: 'Continuous' }).click()
  const row = (label) =>
    page.locator('.explore-row').filter({ has: page.locator('label', { hasText: new RegExp(`^${label}`) }) })
  await row('Trigger').locator('input').fill(trigger)
  await row('Outcome$').locator('input').fill(outcome)
  await row('Outcome lag').locator('input').fill('1')
  await page.getByRole('button', { name: 'Run analysis' }).click()
  await page.locator('.explore-results').waitFor()
  await settle(page, 800)
  await page.locator('.explore-results').evaluate((el) => el.scrollIntoView({ block: 'end' }))
  await page.waitForTimeout(400)
}

const settle = async (page, ms = 1200) => {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(ms)
}

const SHOTS = [
  {
    name: 'dashboard',
    run: async (page) => {
      await page.goto(`${WEB}/`)
      await settle(page, 2000)
    },
  },
  {
    name: 'timeline-day',
    run: async (page, ctx) => {
      const { from, to } = dayWindow(ctx.showcase.day)
      await page.goto(`${WEB}/timeline#from=${from}&to=${to}`)
      await settle(page, 2500)
      await hoverActivity(page, ctx.showcase.run)
    },
  },
  {
    name: 'timeline-mobile',
    device: 'iPhone 13',
    run: async (page, ctx) => {
      const { from, to } = dayWindow(ctx.showcase.day)
      await page.goto(`${WEB}/timeline#from=${from}&to=${to}`)
      await settle(page, 2500)
    },
  },
  {
    name: 'sleep',
    run: async (page) => {
      await page.goto(`${WEB}/sleep`)
      await settle(page, 2000)
    },
  },
  {
    name: 'correlations',
    run: async (page) => {
      await runExplore(page, 'running', 'hrv_rmssd')
    },
  },
  {
    name: 'correlations-alcohol',
    run: async (page) => {
      await runExplore(page, 'alcohol', 'sleep_score')
    },
  },
  {
    name: 'trends',
    run: async (page) => {
      await page.goto(`${WEB}/`)
      await settle(page, 2000)
      await scrollTo(page, page.locator('.metrics-section h2', { hasText: /^Activity/ }))
    },
  },
  {
    name: 'goals',
    run: async (page) => {
      await page.goto(`${WEB}/goals`)
      await settle(page, 2000)
    },
  },
  {
    name: 'challenge',
    run: async (page, ctx) => {
      await page.goto(ctx.challenge.share_url.replace(/^https?:\/\/[^/]+/, WEB))
      await settle(page, 2000)
    },
  },
  {
    name: 'feed',
    run: async (page) => {
      await page.goto(`${WEB}/feed`)
      await settle(page, 2000)
    },
  },
  {
    name: 'feed-own',
    run: async (page) => {
      await page.goto(`${WEB}/feed?tab=mine`)
      await settle(page, 2000)
    },
  },
  {
    loggedOut: true,
    name: 'public-dashboard',
    run: async (page, ctx) => {
      await page.goto(ctx.dashboard.share_url.replace(/^https?:\/\/[^/]+/, WEB))
      await settle(page, 2500)
    },
  },
  {
    name: 'places',
    run: async (page, ctx) => {
      await page.goto(`${WEB}/places?date=${ctx.showcase.day}`)
      await settle(page, 3000)
    },
  },
  {
    name: 'manual-log',
    run: async (page, ctx) => {
      const { from, to } = dayWindow(ctx.showcase.day)
      const params = new URLSearchParams({
        date: ctx.showcase.day,
        from: new Date(Date.parse(from) - 6 * 86_400_000).toISOString(),
        hide: 'location,media,meal,metric,report,screentime',
        to,
        types: 'headache,painkiller,late_coffee,alcohol,sauna,meditation',
      })
      await page.goto(`${WEB}/data?${params}`)
      await settle(page)
    },
  },
  {
    name: 'manual-log-add',
    run: async (page) => {
      await page.goto(`${WEB}/add`)
      await settle(page)
      await page.locator('.form-field', { hasText: 'Activity Type' }).locator('input').first().click()
      await page.keyboard.type('Head')
      await page.locator('.metric-picker-option', { hasText: 'Headache' }).first().click()
      await page.getByPlaceholder('Optional notes').fill('Woke up with it after a short night.')
      await page.waitForTimeout(600)
    },
  },
]

const scrollTo = async (page, locator) => {
  await locator.first().evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(600)
}

const main = async () => {
  const token = await login('maja')
  const [challenges, dashboards, showcase] = await Promise.all([
    api('/challenges', { token }),
    api('/shared-dashboards', { token }),
    pickShowcaseDay(token),
  ])
  const ctx = {
    challenge: challenges.challenges[0],
    dashboard: dashboards.dashboards[0],
    showcase,
    token,
  }
  console.log(
    `showcase day ${showcase.day}, challenge ${ctx.challenge.name}, dashboard ${ctx.dashboard.name}`,
  )

  const browser = await chromium.launch()
  const written = []
  try {
    for (const shot of SHOTS.filter((s) => !ONLY || ONLY.includes(s.name))) {
      for (const theme of THEMES) {
        const viewport = shot.device ? {} : { deviceScaleFactor: 2, viewport: shot.viewport ?? DESKTOP }
        const context = await browser.newContext({
          ...(shot.device ? devices[shot.device] : {}),
          ...viewport,
          colorScheme: theme,
          locale: 'en-GB',
          timezoneId: TZ,
        })
        if (!shot.loggedOut) {
          await context.addInitScript(
            (value) => {
              localStorage.setItem('auth', value)
            },
            JSON.stringify({ is_admin: false, token, user: 'maja' }),
          )
        }
        const page = await context.newPage()
        page.on('pageerror', (error) =>
          console.warn(`  [${shot.name}/${theme}] page error: ${error.message}`),
        )
        await shot.run(page, ctx)
        const file = join(OUT, `${shot.name}-${theme}.png`)
        await page.screenshot({ file, path: file })
        written.push(file)
        console.log(`  wrote ${file}`)
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
  console.log(`${written.length} screenshots in ${OUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
