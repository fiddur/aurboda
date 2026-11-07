#!/usr/bin/env node
// Seeds a fresh Aurboda instance with an invented demo world for screenshots:
// `maja` with ten weeks of sleep, heart rate, workouts, steps, places and
// hand-logged habits, six friends in a step challenge, goals and a public
// dashboard. Everything goes through the REST API (OwnTracks for GPS points).
//
//   node scripts/demo-data/seed.mjs http://127.0.0.1:8080
//
// Run it once against an empty stack; it is not idempotent.

const BASE = (process.argv[2] ?? 'http://127.0.0.1:8080').replace(/\/+$/, '')
const API = `${BASE}/api`
const TZ = 'Europe/Stockholm'
const PASSWORD = process.env.DEMO_PASSWORD ?? 'demo-password-2026'
const DAYS = 70
const LOCATION_DAYS = 14
const NOW = Date.now()
const HOUR = 3_600_000
const MIN = 60_000

const FRIENDS = ['jonas', 'leila', 'tomas', 'noor', 'erik', 'anna_k']

// ---------------------------------------------------------------- randomness

const mulberry32 = (seed) => () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
}

const makeRng = (seed) => {
  const next = mulberry32(seed)
  const normal = (mean = 0, sd = 1) => {
    const u = 1 - next()
    const v = next()
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  return {
    chance: (p) => next() < p,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    next,
    normal,
    pick: (list) => list[Math.floor(next() * list.length)],
    range: (lo, hi) => lo + next() * (hi - lo),
  }
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const round = (v, digits = 0) => Math.round(v * 10 ** digits) / 10 ** digits

// ---------------------------------------------------------------- time in Stockholm

const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  month: '2-digit',
  second: '2-digit',
  timeZone: TZ,
  year: 'numeric',
})

const tzOffsetMs = (instant) => {
  const parts = offsetFormatter.formatToParts(new Date(instant))
  const get = (type) => Number(parts.find((p) => p.type === type).value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - Math.floor(instant / 1000) * 1000
}

/** A wall-clock time in Stockholm (`hours` may exceed 24 to reach the next day) as epoch ms. */
const local = (dayKey, hours) => {
  const [y, m, d] = dayKey.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d) + hours * HOUR
  const first = guess - tzOffsetMs(guess)
  return guess - tzOffsetMs(first)
}

const dayKeyOf = (instant) => new Date(instant + tzOffsetMs(instant)).toISOString().slice(0, 10)
const shiftDay = (dayKey, n) =>
  new Date(Date.parse(`${dayKey}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const weekdayOf = (dayKey) => new Date(`${dayKey}T12:00:00Z`).getUTCDay()
const iso = (ms) => new Date(ms).toISOString()

const TODAY = dayKeyOf(NOW)
const DAY_KEYS = Array.from({ length: DAYS }, (_, i) => shiftDay(TODAY, i - DAYS + 1))

// ---------------------------------------------------------------- HTTP

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const request = async (method, path, { token, body, headers = {}, url } = {}) => {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url ?? `${API}${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      method,
    }).catch((error) => ({ error }))
    if (!res.error && res.status < 500) {
      const text = await res.text()
      const json = text ? JSON.parse(text.startsWith('[') || text.startsWith('{') ? text : 'null') : null
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`)
      return json
    }
    if (attempt >= 4) {
      const detail = res.error ? String(res.error) : `${res.status} ${await res.text()}`
      throw new Error(`${method} ${path} failed: ${detail.slice(0, 400)}`)
    }
    await sleep(500 * attempt)
  }
}

const pool = async (items, size, fn) => {
  let index = 0
  const worker = async () => {
    while (index < items.length) {
      const i = index++
      await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: size }, worker))
}

const signup = async (username) => {
  const res = await request('POST', '/signup', { body: { password: PASSWORD, username } })
  return res.token
}

const client = (token) => ({
  delete: (path) => request('DELETE', path, { token }),
  get: (path) => request('GET', path, { token }),
  patch: (path, body) => request('PATCH', path, { body, token }),
  post: (path, body) => request('POST', path, { body, token }),
  put: (path, body) => request('PUT', path, { body, token }),
})

// Steps arrive the way the phone app sends them: one deduplicated Health Connect
// total per local day (which also tells the server the device timezone).
const postDailySteps = async (api, points) => {
  const totals = new Map()
  for (const p of points) totals.set(dayKeyOf(p.time), (totals.get(dayKeyOf(p.time)) ?? 0) + p.value)
  const data = [...totals].map(([date, value]) => ({
    data_origins: ['com.google.android.apps.fitness'],
    date,
    metric: 'steps',
    timezone: TZ,
    value: Math.round(value),
  }))
  await api.post('/sync/daily-aggregates', { data })
}

const bulkMetrics = async (api, points) => {
  const current = points.filter((p) => p.time <= NOW)
  const steps = current.filter((p) => p.metric === 'steps')
  if (steps.length) await postDailySteps(api, steps)
  const sorted = current.filter((p) => p.metric !== 'steps')
  for (let i = 0; i < sorted.length; i += 10_000) {
    const chunk = sorted
      .slice(i, i + 10_000)
      .map((p) => ({ metric: p.metric, time: iso(p.time), value: p.value }))
    const res = await api.post('/metrics/bulk', { data: chunk })
    if (res.errors?.length) throw new Error(`bulk metrics: ${JSON.stringify(res.errors.slice(0, 3))}`)
  }
}

const addActivity = async (api, activity) => {
  if (activity.start > NOW) return null
  const res = await api.post('/activities', {
    activity_type: activity.type,
    ...(activity.data ? { data: activity.data } : {}),
    ...(activity.end !== undefined ? { end_time: iso(Math.min(activity.end, NOW)) } : {}),
    ...(activity.notes ? { notes: activity.notes } : {}),
    start_time: iso(activity.start),
    ...(activity.title ? { title: activity.title } : {}),
  })
  return res.data.id
}

// ---------------------------------------------------------------- the manually logged things

const CUSTOM_TYPES = [
  { color: '#92400e', display_category: 'other', display_name: 'Coffee', icon: '☕', name: 'coffee' },
  {
    color: '#b45309',
    display_category: 'other',
    display_name: 'Late coffee',
    icon: '☕',
    name: 'late_coffee',
  },
  { color: '#9f1239', display_category: 'other', display_name: 'Alcohol', icon: '🍷', name: 'alcohol' },
  { color: '#dc2626', display_category: 'wellness', display_name: 'Headache', icon: '🤕', name: 'headache' },
  {
    color: '#0ea5e9',
    display_category: 'wellness',
    display_name: 'Painkiller',
    icon: '💊',
    name: 'painkiller',
  },
  { color: '#ea580c', display_category: 'wellness', display_name: 'Sauna', icon: '🧖', name: 'sauna' },
]

// ---------------------------------------------------------------- places (all invented, around Stockholm)

const PLACES = {
  gym: { lat: 59.3338, lon: 18.0362, name: 'Gym', radius: 80 },
  home: { lat: 59.3157, lon: 18.0335, name: 'Home', radius: 100 },
  work: { lat: 59.3327, lon: 18.0287, name: 'Work', radius: 120 },
}

/** The point a fraction `f` of the way along a polyline. */
const along = (path, f) => {
  const legs = path.slice(1).map((p, k) => Math.hypot(p.lat - path[k].lat, (p.lon - path[k].lon) * 0.51))
  let rest = f * legs.reduce((a, b) => a + b, 0)
  for (const [k, leg] of legs.entries()) {
    if (rest <= leg || k === legs.length - 1) {
      const g = leg === 0 ? 0 : Math.min(1, rest / leg)
      return {
        lat: path[k].lat + (path[k + 1].lat - path[k].lat) * g,
        lon: path[k].lon + (path[k + 1].lon - path[k].lon) * g,
      }
    }
    rest -= leg
  }
  return path.at(-1)
}

const loop = (center, rx, ry, n, phase = 0) =>
  Array.from({ length: n }, (_, i) => {
    const a = phase + (2 * Math.PI * i) / n
    return { lat: center.lat + ry * Math.sin(a), lon: center.lon + rx * Math.cos(a) }
  })

// Walking to work over Västerbron; an evening loop around Långholmen; a ride
// south through Liljeholmen and Älvsjö; a hike in Nackareservatet.
const COMMUTE = [
  PLACES.home,
  { lat: 59.3191, lon: 18.0321 },
  { lat: 59.3268, lon: 18.0243 },
  { lat: 59.33, lon: 18.0255 },
  PLACES.work,
]
const LANGHOLMEN = loop({ lat: 59.32136, lon: 18.027 }, 0.0085, 0.00105, 120, -Math.PI / 2 + 0.6)
const RUN_ROUTE = [
  PLACES.home,
  { lat: 59.3186, lon: 18.0326 },
  ...LANGHOLMEN,
  ...LANGHOLMEN,
  LANGHOLMEN[0],
  { lat: 59.3186, lon: 18.0326 },
  PLACES.home,
]
const RIDE_OUT = [
  PLACES.home,
  { lat: 59.3115, lon: 18.027 },
  { lat: 59.308, lon: 18.023 },
  { lat: 59.2985, lon: 18.008 },
  { lat: 59.2785, lon: 18.0105 },
  { lat: 59.256, lon: 17.999 },
  { lat: 59.237, lon: 17.982 },
]
const RIDE_ROUTE = [...RIDE_OUT, ...RIDE_OUT.toReversed()]
const NACKA = loop({ lat: 59.283, lon: 18.15 }, 0.022, 0.009, 200)

// ---------------------------------------------------------------- maja's ten weeks

const buildMajaPlan = () => {
  const rng = makeRng(20_261_107)
  const days = DAY_KEYS.map((key, i) => {
    const wd = weekdayOf(key)
    const weekend = wd === 0 || wd === 6
    const progress = i / (DAYS - 1)
    const day = { activities: [], i, key, progress, wd, weekend, workouts: [] }
    // Yesterday is the day the day views show: a full, varied and clean day.
    const showcase = i === DAYS - 2

    if (rng.chance(weekend ? 0.7 : 0.88) || showcase) {
      day.activities.push({
        start: local(key, weekend ? rng.range(8.3, 9.5) : rng.range(7.0, 7.4)),
        type: 'coffee',
      })
    }
    if (rng.chance(0.42) || showcase) {
      const start = local(key, weekend ? rng.range(8.6, 9.2) : rng.range(6.85, 6.95))
      day.activities.push({
        end: start + rng.int(10, 16) * MIN,
        start,
        title: 'Morning meditation',
        type: 'meditation',
      })
    }

    const workout = (type, startHour, minutes, extra = {}) => {
      const start = local(key, startHour)
      day.workouts.push({ end: start + minutes * MIN, start, type, ...extra })
    }

    if (wd === 1 && rng.chance(0.9))
      workout('strength_training', rng.range(11.9, 12.2), rng.int(48, 58), { slot: 'lunch' })
    if (wd === 2 && rng.chance(0.85)) {
      workout('running', rng.range(17.8, 18.6), rng.int(38, 50), {
        interval: true,
        title: 'Evening run',
      })
    }
    if (wd === 3 && rng.chance(0.45))
      workout('yoga', rng.range(19.3, 19.7), rng.int(30, 45), { title: 'Yin yoga' })
    if (wd === 4 && rng.chance(0.9))
      workout('strength_training', rng.range(17.4, 17.7), rng.int(50, 62), { slot: 'evening' })
    if (wd === 5 && rng.chance(0.3))
      workout('running', rng.range(17.6, 18.2), rng.int(30, 40), { title: 'Evening run' })
    if (wd === 6 && rng.chance(0.85)) {
      if (rng.chance(0.55))
        workout('biking', rng.range(9.8, 10.5), rng.int(50, 75), { title: 'Saturday ride' })
      else workout('hiking', rng.range(10.0, 10.6), rng.int(110, 150), { title: 'Hike in Nacka' })
    }
    if (wd === 0) {
      if (rng.chance(0.6)) workout('running', rng.range(16.8, 18.3), rng.int(45, 65), { title: 'Sunday run' })
      else if (rng.chance(0.5)) workout('yoga', rng.range(18.5, 19.0), rng.int(30, 40), { title: 'Yoga' })
    }

    const thursdayStrength = wd === 4 && day.workouts.some((w) => w.type === 'strength_training')
    if ((thursdayStrength && rng.chance(0.55)) || (wd === 0 && rng.chance(0.2))) {
      const start = thursdayStrength ? day.workouts[0].end + rng.range(15, 30) * MIN : local(key, 15.5)
      day.sauna = true
      day.activities.push({ end: start + rng.int(20, 30) * MIN, start, title: 'Sauna', type: 'sauna' })
    }

    if (showcase && !day.workouts.some((w) => w.type === 'running' && dayHour(key, w.start) >= 16.5)) {
      const busy = day.workouts.some((w) => w.end > local(key, 17.5))
      workout('running', busy ? 19.4 : 18.1, 44, { title: 'Evening run' })
    }
    day.alcohol = !showcase && rng.chance(wd === 5 || wd === 6 ? 0.65 : 0.1)
    if (day.alcohol) {
      day.activities.push({
        data: undefined,
        start: local(key, rng.range(19.3, 21.2)),
        title: rng.pick(['Glass of wine', 'Two beers', 'Wine with dinner', 'Drinks with friends']),
        type: 'alcohol',
      })
    }
    day.lateCoffee = !showcase && rng.chance(weekend ? 0.1 : 0.24)
    if (day.lateCoffee) day.activities.push({ start: local(key, rng.range(15.4, 17.2)), type: 'late_coffee' })

    day.eveningRun = day.workouts.some((w) => w.type === 'running' && dayHour(key, w.start) >= 16.5)
    return day
  })

  // The night after day i: bedtime that evening, wake-up the next morning.
  for (const day of days.slice(0, -1)) {
    const next = shiftDay(day.key, 1)
    const nextWeekend = [0, 6].includes(weekdayOf(next))
    const lateEvening = day.workouts.find((w) => w.end > local(day.key, 21.5))
    const bed = Math.max(
      local(day.key, (nextWeekend ? 23.6 : 22.8) + (day.alcohol ? 0.6 : 0) + rng.normal(0, 0.35)),
      lateEvening ? lateEvening.end + 45 * MIN : 0,
    )
    const latencyMin = clamp(rng.normal(day.lateCoffee ? 38 : 12, 6), 3, 70)
    const wake = local(next, nextWeekend ? rng.range(7.5, 8.4) : rng.range(6.45, 6.85))
    const sleepHours = (wake - bed) / HOUR - latencyMin / 60
    const effects = {
      alcohol: day.alcohol ? 1 : 0,
      eveningRun: day.eveningRun ? 1 : 0,
      lateCoffee: day.lateCoffee ? 1 : 0,
      sauna: day.sauna ? 1 : 0,
    }
    const score = clamp(
      Math.round(
        79 +
          3 * day.progress +
          6 * effects.eveningRun +
          3 * effects.sauna -
          13 * effects.alcohol -
          8 * effects.lateCoffee +
          (sleepHours - 7.2) * 4 +
          rng.normal(0, 3),
      ),
      42,
      97,
    )
    const hrv = clamp(
      49 +
        5 * day.progress +
        8 * effects.eveningRun +
        3 * effects.sauna -
        13 * effects.alcohol -
        3 * effects.lateCoffee +
        rng.normal(0, 4),
      22,
      90,
    )
    const rhr = clamp(
      55.5 -
        2.5 * day.progress -
        1.5 * effects.eveningRun +
        5 * effects.alcohol +
        1 * effects.lateCoffee +
        rng.normal(0, 1.1),
      45,
      70,
    )
    day.night = { bed, effects, hrv, latencyMin, rhr, score, sleepHours, wake }
  }

  // Headaches follow short nights and drinking; a painkiller usually follows.
  for (const day of days.slice(1)) {
    if (day.i === DAYS - 2) continue
    const prev = days[day.i - 1].night
    const p = 0.07 + (prev.sleepHours < 7.3 ? 0.3 : 0) + (prev.effects.alcohol ? 0.45 : 0)
    if (!rng.chance(p)) continue
    const start = local(day.key, rng.range(9.5, 15.5))
    const end = start + rng.range(1.5, 4.5) * HOUR
    day.headache = true
    day.activities.push({ end, start, type: 'headache' })
    if (rng.chance(0.75)) day.activities.push({ start: start + rng.range(20, 70) * MIN, type: 'painkiller' })
  }

  return { days, rng }
}

const dayHour = (key, instant) => (instant - local(key, 0)) / HOUR

const sleepStages = (rng, night) => {
  const segments = []
  const onset = night.bed + night.latencyMin * MIN
  segments.push({ end: onset, stage: 1, start: night.bed })
  let t = onset
  let cycle = 0
  const awakeChance = night.effects.alcohol ? 0.55 : 0.25
  while (t < night.wake - 5 * MIN) {
    const length = rng.range(85, 100) * MIN
    const deepShare = [0.34, 0.24, 0.12, 0.05, 0.03][Math.min(cycle, 4)] * (night.effects.alcohol ? 0.75 : 1)
    const remShare =
      [0.1, 0.16, 0.22, 0.28, 0.3][Math.min(cycle, 4)] * (night.effects.alcohol && cycle < 2 ? 0.5 : 1)
    const parts = [
      [4, 0.3],
      [5, deepShare],
      [4, 1 - 0.3 - deepShare - remShare],
      [6, remShare],
    ]
    for (const [stage, share] of parts) {
      const end = Math.min(t + share * length, night.wake)
      if (end > t + MIN) segments.push({ end, stage, start: t })
      t = end
    }
    if (t < night.wake - 10 * MIN && rng.chance(awakeChance)) {
      const end = t + rng.range(2, 7) * MIN
      segments.push({ end, stage: 1, start: t })
      t = end
    }
    cycle++
  }
  if (t < night.wake) segments.push({ end: night.wake, stage: 4, start: t })
  return segments
}

// Heart rate (bpm) for a workout, sampled every 5 s.
const workoutHeartRate = (rng, workout) => {
  const points = []
  const duration = workout.end - workout.start
  let drift = 0
  for (let t = workout.start; t <= workout.end; t += 5000) {
    const f = (t - workout.start) / duration
    const minute = (t - workout.start) / MIN
    let hr
    switch (workout.type) {
      case 'running': {
        const warm = Math.min(1, minute / 6)
        if (workout.interval && minute > 10 && minute < duration / MIN - 6) {
          const k = (minute - 10) % 5
          hr = k < 3 ? (k < 1.9 ? 155 : 165) : 130
        } else {
          hr = 94 + warm * 24 + f * 7 + (f > 0.86 && f < 0.95 ? 18 : 0)
        }
        break
      }
      case 'strength_training': {
        const k = minute % 2.6
        hr = 92 + (k < 0.8 ? 30 + k * 15 : Math.max(0, 42 - (k - 0.8) * 26)) + Math.min(10, minute / 4)
        break
      }
      case 'biking':
        hr = 98 + Math.min(1, minute / 8) * 18 + 6 * Math.sin(minute / 7)
        break
      case 'hiking':
        hr = 92 + Math.min(1, minute / 10) * 16 + 9 * Math.sin(minute / 11) + 4 * Math.sin(minute / 3)
        break
      default:
        hr = 78 + 6 * Math.sin(minute / 5)
    }
    drift = drift * 0.9 + rng.normal(0, 1.2)
    points.push({ metric: 'heart_rate', time: t, value: Math.round(hr + drift) })
  }
  return points
}

const STRENGTH = [
  { base: 52, exercise: 'Squat', reps: [8, 8, 6, 6] },
  { base: 37, exercise: 'Bench Press', reps: [8, 8, 8] },
  { base: 70, exercise: 'Deadlift', reps: [5, 5, 5] },
  { base: 32, exercise: 'Barbell Row', reps: [10, 10, 10] },
  { base: 24, exercise: 'Overhead Press', reps: [8, 8, 6] },
  { base: 0, exercise: 'Pull-up', reps: [6, 5, 5] },
]

const strengthSets = (rng, progress, slot) => {
  const chosen = slot === 'lunch' ? [0, 1, 3, 5] : [2, 4, 3, 5]
  return chosen.flatMap((index) => {
    const ex = STRENGTH[index]
    const weight = ex.base === 0 ? undefined : round((ex.base * (1 + 0.1 * progress)) / 2.5) * 2.5
    return ex.reps.map((reps) => ({
      exercise: ex.exercise,
      reps: Math.max(3, reps + (rng.chance(0.2) ? -1 : 0)),
      ...(weight !== undefined ? { weight } : {}),
    }))
  })
}

const KM_PER_MIN = { biking: 0.4, hiking: 0.068, running: 0.172 }
const KCAL_PER_MIN = { biking: 7.5, hiking: 5.2, running: 10.2, strength_training: 5.4, yoga: 3 }

const workoutSummary = (rng, w, progress) => {
  const minutes = (w.end - w.start) / MIN
  const data = { calories: Math.round(minutes * (KCAL_PER_MIN[w.type] ?? 4) * rng.range(0.92, 1.08)) }
  if (KM_PER_MIN[w.type])
    data.distance = Math.round(
      minutes * KM_PER_MIN[w.type] * (1 + 0.04 * progress) * rng.range(0.95, 1.05) * 1000,
    )
  if (w.type === 'strength_training') data.sets = strengthSets(rng, progress, w.slot)
  return data
}

const stepsForDay = (rng, day, workouts, stepScale = 1) => {
  // Per 15-minute bucket: a little pottering, commute walks, workouts on foot.
  const buckets = new Map()
  const add = (from, to, perMinute) => {
    for (let t = from; t < to; t += MIN) {
      const bucket = t - (t % (15 * MIN))
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + perMinute * rng.range(0.8, 1.2))
    }
  }
  const wake = day.wake ?? local(day.key, day.weekend ? 8 : 6.7)
  const bed = day.bed ?? local(day.key, 23)
  add(wake, bed, 3.2 * stepScale)
  if (!day.weekend) {
    add(local(day.key, 7.6), local(day.key, 8.05), 98)
    add(local(day.key, 16.9), local(day.key, 17.35), 96)
    if (rng.chance(0.55)) add(local(day.key, 12.15), local(day.key, 12.45), 88)
  } else {
    const walk = local(day.key, rng.range(12, 15.5))
    add(walk, walk + rng.range(25, 70) * MIN, 92 * stepScale)
  }
  for (const w of workouts) {
    const rate = { hiking: 82, running: 162, strength_training: 14, yoga: 2 }[w.type] ?? 0
    if (rate) add(w.start, w.end, rate)
  }
  return [...buckets].map(([time, value]) => ({ metric: 'steps', time, value: Math.round(value) }))
}

const majaMetrics = (rng, days) => {
  const points = []
  for (const day of days) {
    const night = day.night
    const prevNight = day.i > 0 ? days[day.i - 1].night : undefined
    const wake = prevNight?.wake ?? local(day.key, 6.7)
    const bed = night?.bed ?? local(day.key, 23)
    const inChallenge = day.i >= DAYS - 18
    points.push(...stepsForDay(rng, { ...day, bed, wake }, day.workouts, inChallenge ? 1.25 : 1))

    // Daytime heart rate every 2 minutes, outside workouts.
    const busy = day.workouts.map((w) => [w.start, w.end + 20 * MIN])
    for (let t = wake; t < bed; t += 2 * MIN) {
      const after = day.workouts.find((w) => t >= w.end && t < w.end + 20 * MIN)
      const inside = busy.some(([s, e]) => t >= s && t < e) && !after
      if (inside) continue
      const walking =
        !day.weekend &&
        ((t >= local(day.key, 7.6) && t < local(day.key, 8.05)) ||
          (t >= local(day.key, 16.9) && t < local(day.key, 17.35)))
      const recovery = after ? 25 * (1 - (t - after.end) / (20 * MIN)) : 0
      points.push({
        metric: 'heart_rate',
        time: t,
        value: Math.round(67 + (walking ? 24 : 0) + recovery + rng.normal(0, 3.2)),
      })
    }
    for (const w of day.workouts) points.push(...workoutHeartRate(rng, w))

    if (!night) continue
    const stages = sleepStages(rng, night)
    night.stages = stages
    for (let t = night.bed; t < night.wake; t += 2 * MIN) {
      const stage = stages.find((s) => t >= s.start && t < s.end)?.stage ?? 4
      const bump = { 1: 7, 4: 2, 5: -1, 6: 4 }[stage] ?? 2
      const settle = Math.max(0, 6 - (t - night.bed) / (30 * MIN))
      points.push({
        metric: 'heart_rate',
        time: t,
        value: Math.round(night.rhr + 2 + bump + settle + rng.normal(0, 1.4)),
      })
    }
    const utcMidnight = Date.parse(`${iso(night.wake).slice(0, 10)}T00:00:00Z`)
    for (
      let t = Math.max(utcMidnight, night.bed + night.latencyMin * MIN) + 3 * MIN;
      t < night.wake;
      t += 5 * MIN
    ) {
      const stage = stages.find((s) => t >= s.start && t < s.end)?.stage ?? 4
      const bump = { 1: -6, 5: 7, 6: -2 }[stage] ?? 0
      points.push({
        metric: 'hrv_rmssd',
        time: t,
        value: round(Math.max(12, night.hrv + bump + rng.normal(0, 5)), 1),
      })
    }
    points.push({ metric: 'sleep_score', time: night.wake, value: night.score })
    points.push({ metric: 'resting_heart_rate', time: night.wake, value: round(night.rhr, 1) })
    const readiness = clamp(
      Math.round(74 + (night.hrv - 52) * 0.7 - (night.rhr - 54) * 1.6 + (night.score - 80) * 0.35),
      40,
      98,
    )
    points.push({ metric: 'readiness_score', time: night.wake + MIN, value: readiness })
    const asleepMs = stages.filter((st) => st.stage !== 1).reduce((sum, st) => sum + st.end - st.start, 0)
    points.push({
      metric: 'sleep_efficiency',
      time: night.wake,
      value: Math.round((100 * asleepMs) / (night.wake - night.bed)),
    })
    points.push({ metric: 'sleep_latency', time: night.wake, value: Math.round(night.latencyMin) })
  }
  return points
}

// GPS points for the last two weeks, sent the way the OwnTracks app sends them.
const majaLocations = (rng, days) => {
  const points = []
  const jitter = (p, m = 12) => ({
    lat: p.lat + rng.normal(0, m / 111_000),
    lon: p.lon + rng.normal(0, m / 56_000),
  })
  const stay = (place, from, to, every) => {
    for (let t = from; t < to; t += every * MIN) points.push({ ...jitter(place), time: t })
  }
  const route = (path, from, to, every = 60) => {
    const n = Math.max(2, Math.round((to - from) / (every * 1000)))
    for (let k = 0; k <= n; k++)
      points.push({ ...jitter(along(path, k / n), 5), time: from + (k / n) * (to - from) })
  }
  const travel = (path, from, to) => route(path, from, to, 60)

  for (const day of days.slice(-LOCATION_DAYS)) {
    const prev = days[day.i - 1]?.night
    const dayStart = prev?.wake ?? local(day.key, 6.7)
    const dayEnd = day.night?.bed ?? local(day.key, 23)
    let at = prev ? prev.bed : local(day.key, 0)
    const events = []
    if (!day.weekend) {
      events.push({
        from: local(day.key, 7.6),
        kind: 'walk',
        path: COMMUTE,
        to: local(day.key, 8.05),
      })
      for (const w of day.workouts) {
        if (w.type === 'strength_training' && w.slot === 'lunch')
          events.push(
            { from: w.start - 6 * MIN, kind: 'walk', path: [PLACES.work, PLACES.gym], to: w.start },
            { from: w.start, kind: 'stay', place: PLACES.gym, to: w.end },
            { from: w.end, kind: 'walk', path: [PLACES.gym, PLACES.work], to: w.end + 6 * MIN },
          )
      }
      const thursday = day.workouts.find((w) => w.type === 'strength_training' && w.slot === 'evening')
      if (thursday) {
        events.push(
          { from: local(day.key, 16.9), kind: 'walk', path: [PLACES.work, PLACES.gym], to: thursday.start },
          {
            from: thursday.start,
            kind: 'stay',
            place: PLACES.gym,
            to: day.sauna ? thursday.end + 60 * MIN : thursday.end,
          },
          {
            from: day.sauna ? thursday.end + 60 * MIN : thursday.end,
            kind: 'walk',
            path: [PLACES.gym, ...COMMUTE.toReversed().slice(1)],
            to: day.sauna ? thursday.end + 90 * MIN : thursday.end + 30 * MIN,
          },
        )
      } else {
        events.push({
          from: local(day.key, 16.9),
          kind: 'walk',
          path: COMMUTE.toReversed(),
          to: local(day.key, 17.35),
        })
      }
    }
    for (const w of day.workouts) {
      if (w.type === 'running')
        events.push({ every: 15, from: w.start, kind: 'route', path: RUN_ROUTE, to: w.end })
      if (w.type === 'biking')
        events.push({ every: 20, from: w.start, kind: 'route', path: RIDE_ROUTE, to: w.end })
      if (w.type === 'hiking') {
        events.push(
          { from: w.start - 35 * MIN, kind: 'gap', to: w.start },
          { every: 20, from: w.start, kind: 'route', path: [...NACKA, NACKA[0]], to: w.end },
          { from: w.end, kind: 'gap', to: w.end + 35 * MIN },
        )
      }
    }
    events.sort((a, b) => a.from - b.from)
    let place = PLACES.home
    for (const e of events) {
      if (e.from > at) stay(place, at, e.from, at < dayStart || at > dayEnd ? 20 : 10)
      if (e.kind === 'walk') {
        travel(e.path, e.from, e.to)
        place = e.path.at(-1)
      } else if (e.kind === 'stay') {
        stay(e.place, e.from, e.to, 10)
        place = e.place
      } else if (e.kind === 'route') {
        route(e.path, e.from, e.to, e.every)
      }
      at = Math.max(at, e.to)
    }
    stay(place, at, day.night ? day.night.bed : Math.min(NOW, local(day.key, 24)), 10)
  }
  return points.filter((p) => p.time <= NOW).sort((a, b) => a.time - b.time)
}

// ---------------------------------------------------------------- meals for the last few days

const MEALS = {
  breakfast: [
    { calories: 420, carbs: 52, fat: 14, fiber: 8, name: 'Oatmeal with berries and yoghurt', protein: 20 },
    { calories: 380, carbs: 34, fat: 16, fiber: 6, name: 'Rye bread, eggs and cucumber', protein: 24 },
  ],
  dinner: [
    { calories: 640, carbs: 58, fat: 22, fiber: 9, name: 'Salmon, potatoes and greens', protein: 42 },
    { calories: 590, carbs: 70, fat: 16, fiber: 11, name: 'Lentil curry with rice', protein: 26 },
    {
      calories: 610,
      carbs: 62,
      fat: 20,
      fiber: 7,
      name: 'Chicken, bulgur and roasted vegetables',
      protein: 45,
    },
  ],
  lunch: [
    { calories: 560, carbs: 60, fat: 18, fiber: 9, name: 'Falafel bowl', protein: 22 },
    { calories: 520, carbs: 48, fat: 17, fiber: 6, name: 'Pasta salad with tuna', protein: 32 },
  ],
  snack: [{ calories: 210, carbs: 26, fat: 9, fiber: 4, name: 'Apple and a handful of almonds', protein: 6 }],
}

const majaMeals = (rng, days) =>
  days.slice(-5).flatMap((day) => {
    const lunchLift = day.workouts.find((w) => w.slot === 'lunch')
    const evening = day.workouts.find((w) => w.end > local(day.key, 17))
    const meals = [
      ['breakfast', local(day.key, day.weekend ? 8.8 : 7.25)],
      ['lunch', lunchLift ? lunchLift.end + 25 * MIN : local(day.key, day.weekend ? 13 : 12)],
      ['snack', local(day.key, 15.3)],
      ['dinner', evening ? Math.max(evening.end + 40 * MIN, local(day.key, 18.8)) : local(day.key, 18.6)],
    ]
    return meals.map(([meal_type, time]) => ({ ...rng.pick(MEALS[meal_type]), meal_type, time }))
  })

// ---------------------------------------------------------------- friends

const FRIEND_PROFILES = {
  anna_k: (d, n, rng) => rng.normal(9200, 2300),
  erik: (d, n, rng) => rng.normal(10_400, 1400),
  jonas: (d, n, rng) => rng.normal(14_300, 1100),
  leila: (d, n, rng) => (d < n * 0.45 ? rng.normal(7600, 900) : rng.normal(15_600, 1000)),
  noor: (d, n, rng) => rng.normal(10_700, 1300),
  tomas: (d, n, rng) => (d < 6 ? rng.normal(12_800, 900) : rng.normal(3200, 900)),
}

const friendSteps = (name, seed, fromKey) => {
  const rng = makeRng(seed)
  const keys = DAY_KEYS.filter((k) => k >= fromKey)
  const points = []
  keys.forEach((key, d) => {
    const total = clamp(FRIEND_PROFILES[name](d, 18, rng), 1500, 18_500)
    const weights = Array.from({ length: 64 }, (_, k) => {
      const hour = 7 + k / 4
      return (
        (hour > 7.4 && hour < 8.3 ? 6 : 0) +
        (hour > 16.8 && hour < 17.8 ? 6 : 0) +
        (hour > 12 && hour < 12.6 ? 3 : 0) +
        rng.range(0.3, 1.6) +
        (rng.chance(0.06) ? 8 : 0)
      )
    })
    const sum = weights.reduce((a, b) => a + b, 0)
    weights.forEach((w, k) =>
      points.push({ metric: 'steps', time: local(key, 7 + k / 4), value: Math.round((total * w) / sum) }),
    )
  })
  return points
}

const friendRuns = (rng, count, paceHr) => {
  const runs = []
  for (let k = 0; k < count; k++) {
    const key = DAY_KEYS[DAYS - 2 - k * 3 - rng.int(0, 1)]
    const start = local(key, rng.range(17.3, 18.6))
    const minutes = rng.int(32, 55)
    const pace = paceHr > 145 ? 0.19 : 0.165
    runs.push({
      data: { calories: Math.round(minutes * 10.5), distance: Math.round(minutes * pace * 1000) },
      end: start + minutes * MIN,
      start,
      title: k === 0 ? 'Evening run' : 'Run',
      type: 'running',
    })
  }
  return runs
}

// ---------------------------------------------------------------- dashboards, goals, challenge

const sharedDashboardConfig = {
  description: 'How training and recovery move together, week by week.',
  sections: [
    {
      id: 'recovery',
      title: 'Recovery',
      type: 'charts',
      widgets: [
        {
          config: {
            display_period: 'daily',
            half_life_days: 7,
            lookback_days: 70,
            pattern: 'hrv_rmssd',
            source_type: 'metric',
            title: 'Overnight HRV',
          },
          id: 'hrv',
          type: 'trend_chart',
        },
        {
          config: {
            display_period: 'daily',
            half_life_days: 7,
            lookback_days: 70,
            pattern: 'resting_heart_rate',
            source_type: 'metric',
            title: 'Resting heart rate',
          },
          id: 'rhr',
          type: 'trend_chart',
        },
      ],
    },
    {
      id: 'training',
      title: 'Training',
      type: 'charts',
      widgets: [
        {
          config: {
            aggregation: 'sum',
            display_period: 'daily',
            half_life_days: 7,
            lookback_days: 70,
            pattern: 'steps',
            source_type: 'metric',
            title: 'Steps per day',
          },
          id: 'steps',
          type: 'trend_chart',
        },
        {
          config: {
            aggregation: 'sum',
            display_period: 'weekly',
            half_life_days: 10,
            lookback_days: 70,
            pattern: 'running',
            source_type: 'activity_type',
            title: 'Running time per week',
          },
          id: 'running',
          type: 'trend_chart',
        },
      ],
    },
  ],
  version: 1,
}

const SEASONS = [
  'Winter',
  'Winter',
  'Spring',
  'Spring',
  'Spring',
  'Summer',
  'Summer',
  'Summer',
  'Autumn',
  'Autumn',
  'Autumn',
  'Winter',
]

// ---------------------------------------------------------------- the social graph (optional, SQL)

// Following and being followed go through ActivityPub, and an instance refuses
// to dereference its own loopback origin, so users of one local instance can
// never follow each other over the API. With DEMO_COMPOSE_PROJECT set, the
// follows, kudos and comments are written straight into maja's database the
// way federation would have stored them. Friends' posts are stored without
// their structured payload; the app enriches same-instance posts by itself.

const DISPLAY_NAMES = {
  anna_k: 'Anna K',
  erik: 'Erik',
  jonas: 'Jonas',
  leila: 'Leila',
  noor: 'Noor',
  tomas: 'Tomas',
}

const sqlText = (value) =>
  value === null || value === undefined ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`

const runSql = async (project, database, sql) => {
  const { spawnSync } = await import('node:child_process')
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-p',
      project,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'aurboda_service',
      '-d',
      database,
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
    ],
    { encoding: 'utf8', input: sql },
  )
  if (result.status !== 0) throw new Error(`psql on ${database} failed: ${result.stderr || result.error}`)
}

const seedSocial = async ({ project, origin, maja, friendTokens }) => {
  const actor = (name) => `${origin}/users/${name}`
  const handle = (name) => `@${name}@${new URL(origin).host}`
  const statements = []

  for (const [k, name] of FRIENDS.entries()) {
    const since = `now() - interval '${20 + k * 3} days'`
    const cols = `${sqlText(actor(name))}, ${sqlText(`${actor(name)}/inbox`)}, ${sqlText(handle(name))}, ${sqlText(DISPLAY_NAMES[name])}, true, ${since}`
    statements.push(
      `INSERT INTO feed_following (actor_uri, inbox_uri, handle, display_name, accepted, created_at) VALUES (${cols}) ON CONFLICT DO NOTHING;`,
      `INSERT INTO feed_follower (actor_uri, inbox_uri, handle, display_name, accepted, created_at) VALUES (${cols}) ON CONFLICT DO NOTHING;`,
    )
  }

  // Friends' own shared runs land on maja's home timeline.
  for (const name of ['jonas', 'leila']) {
    const { posts } = await client(friendTokens[name]).get('/feed')
    for (const post of posts) {
      const published = new Date(
        Date.parse(post.activity_end_time ?? post.created_at) + 35 * MIN,
      ).toISOString()
      const uri = `${actor(name)}/feed/${post.id}`
      statements.push(
        `UPDATE feed_posts SET created_at = ${sqlText(published)}, updated_at = ${sqlText(published)} WHERE id = ${sqlText(post.id)};`,
      )
      statements.push(
        `INSERT INTO timeline_entry (object_uri, actor_uri, handle, display_name, content, url, published_at, received_at, reply_checked_at) VALUES (${sqlText(uri)}, ${sqlText(actor(name))}, ${sqlText(handle(name))}, ${sqlText(DISPLAY_NAMES[name])}, ${sqlText(post.content)}, ${sqlText(uri)}, ${sqlText(published)}, ${sqlText(published)}, now()) ON CONFLICT (object_uri) DO NOTHING;`,
      )
      await runSql(
        project,
        `aurboda_${name}`,
        `UPDATE feed_posts SET created_at = ${sqlText(published)}, updated_at = ${sqlText(published)} WHERE id = ${sqlText(post.id)};`,
      )
    }
  }

  // Kudos and a couple of comments on maja's own posts, posted after the workout.
  const comments = {
    running: [
      ['jonas', 'Nice pace!'],
      ['leila', 'That loop is the best one in town.'],
    ],
    strength_training: [['noor', 'Strong! 💪']],
  }
  const { posts } = await maja.get('/feed')
  for (const [index, post] of posts.entries()) {
    const published = Date.parse(post.activity_end_time ?? post.created_at) + 30 * MIN
    statements.push(
      `UPDATE feed_posts SET created_at = ${sqlText(iso(published))}, updated_at = ${sqlText(iso(published))} WHERE id = ${sqlText(post.id)};`,
    )
    const likers = FRIENDS.filter((_, k) => (k + index) % 4 !== 3)
    for (const [k, name] of likers.entries()) {
      statements.push(
        `INSERT INTO feed_post_reaction (post_id, kind, actor_uri, activity_uri, handle, display_name, created_at) VALUES (${sqlText(post.id)}, 'like', ${sqlText(actor(name))}, ${sqlText(`${actor(name)}/likes/${post.id}`)}, ${sqlText(handle(name))}, ${sqlText(DISPLAY_NAMES[name])}, ${sqlText(iso(published + (k + 1) * 11 * MIN))}) ON CONFLICT DO NOTHING;`,
      )
    }
    for (const [k, [name, text]] of (comments[post.activity_type] ?? []).entries()) {
      const at = iso(published + (k + 1) * 23 * MIN)
      const uri = `${actor(name)}/feed/${crypto.randomUUID()}`
      statements.push(
        `INSERT INTO timeline_entry (object_uri, actor_uri, handle, display_name, content, url, published_at, received_at, reply_checked_at, in_reply_to_uri, enrich_attempted_at) VALUES (${sqlText(uri)}, ${sqlText(actor(name))}, ${sqlText(handle(name))}, ${sqlText(DISPLAY_NAMES[name])}, ${sqlText(`<p>${text}</p>`)}, ${sqlText(uri)}, ${sqlText(at)}, ${sqlText(at)}, now(), ${sqlText(`${actor('maja')}/feed/${post.id}`)}, now()) ON CONFLICT (object_uri) DO NOTHING;`,
      )
    }
  }
  await runSql(project, 'aurboda_maja', `BEGIN;\n${statements.join('\n')}\nCOMMIT;\n`)
}

// ---------------------------------------------------------------- main

const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`)

const main = async () => {
  log(`seeding ${BASE}, ${DAYS} days ending ${TODAY} (${TZ})`)
  const version = await request('GET', '/version')
  log(`instance build ${version.build_sha ?? JSON.stringify(version)}`)

  const majaToken = await signup('maja')
  const maja = client(majaToken)
  const friendTokens = {}
  for (const name of FRIENDS) friendTokens[name] = await signup(name)
  log('signed up maja and friends')

  await maja.patch('/user/settings', { birth_date: '1991-05-14', sex: 'female' })
  for (const t of CUSTOM_TYPES) await maja.post('/activity-types', { ...t, show_on_timeline: true })

  const { days, rng } = buildMajaPlan()
  const metrics = majaMetrics(rng, days)
  await bulkMetrics(maja, metrics)
  log(`maja: ${metrics.length} metric points`)

  // Sleep, workouts and the hand-logged things.
  const activities = []
  for (const day of days) {
    if (day.night && day.night.wake <= NOW) {
      activities.push({
        data: {
          stages: day.night.stages.map((s) => ({
            endTime: iso(s.end),
            stage: s.stage,
            startTime: iso(s.start),
          })),
        },
        end: day.night.wake,
        start: day.night.bed,
        type: 'sleep',
      })
    }
    for (const w of day.workouts) {
      activities.push({
        data: workoutSummary(rng, w, day.progress),
        end: w.end,
        start: w.start,
        title:
          w.title ??
          (w.type === 'strength_training' ? (w.slot === 'lunch' ? 'Lunch lift' : 'Strength') : undefined),
        type: w.type,
        workout: w,
      })
    }
    activities.push(...day.activities)
  }
  const ids = new Map()
  await pool(activities, 6, async (a) => {
    const id = await addActivity(maja, a)
    if (a.workout) ids.set(a.workout, id)
  })
  log(`maja: ${activities.length} activities`)

  const meals = majaMeals(rng, days).filter((m) => m.time <= NOW)
  for (const meal of meals) await maja.post('/meals', { ...meal, time: iso(meal.time) })
  log(`maja: ${meals.length} meals`)

  for (const place of Object.values(PLACES)) {
    await maja.post('/locations/named', { auto_create_activity: true, ...place })
  }
  const locations = majaLocations(rng, days)
  const basic = `Basic ${Buffer.from(`maja:${PASSWORD}`).toString('base64')}`
  await pool(locations, 8, (p) =>
    request('POST', '', {
      body: {
        _type: 'location',
        acc: 8,
        lat: round(p.lat, 6),
        lon: round(p.lon, 6),
        tst: Math.floor(p.time / 1000),
        vel: 0,
      },
      headers: { authorization: basic },
      url: `${API}/ownTracks`,
    }),
  )
  log(`maja: ${locations.length} GPS points`)

  const settings = await maja.get('/user/settings')
  const goals = [
    ...settings.goals,
    {
      goal_type: 'metric',
      id: '1b6f0c56-7d3e-4c1a-9a51-6a0f3b1d2e01',
      metric: 'steps',
      min: 8000,
      window: '1d',
    },
    {
      display_period: 'weekly',
      goal_type: 'trend',
      half_life_days: 15,
      id: '1b6f0c56-7d3e-4c1a-9a51-6a0f3b1d2e02',
      min: 2,
      pattern: 'running',
      source_type: 'activity_type',
    },
    {
      display_period: 'weekly',
      goal_type: 'trend',
      half_life_days: 15,
      id: '1b6f0c56-7d3e-4c1a-9a51-6a0f3b1d2e03',
      max: 2,
      pattern: 'alcohol',
      source_type: 'activity_type',
    },
  ]
  await maja.patch('/user/settings', { goals })

  const dashboard = await maja.post('/shared-dashboards', {
    config: sharedDashboardConfig,
    name: 'Training and recovery',
    visibility: 'public',
  })
  log(`shared dashboard: ${dashboard.dashboard.share_url}`)

  // The step challenge: four weeks, started 17 days ago.
  const startKey = shiftDay(TODAY, -17)
  const startMs = local(startKey, 0)
  const endMs = local(shiftDay(startKey, 28), 0)
  const challengeName = `${SEASONS[new Date(startMs).getUTCMonth()]} step challenge`
  const challenge = (
    await maja.post('/challenges', {
      end_ts: iso(endMs),
      name: challengeName,
      spec: {
        aggregation: 'sum',
        bucket_size: 'auto',
        pattern: 'steps',
        source_type: 'metric',
        unit: 'steps',
      },
      start_ts: iso(startMs),
      timezone: TZ,
      visibility: 'public',
    })
  ).challenge
  log(`challenge "${challenge.name}": ${challenge.share_url}`)

  let seed = 7
  for (const name of FRIENDS) {
    const api = client(friendTokens[name])
    await api.post('/challenges/join', { challenge_url: challenge.share_url })
    await bulkMetrics(api, friendSteps(name, (seed += 101), shiftDay(startKey, -4)))
  }
  log('friends joined the challenge and logged their steps')

  // A couple of friends run too, so they have something of their own to share.
  for (const [name, hr] of [
    ['jonas', 148],
    ['leila', 141],
  ]) {
    const api = client(friendTokens[name])
    const frng = makeRng((seed += 13))
    const runs = friendRuns(frng, 3, hr)
    const hrPoints = runs.flatMap((r) =>
      workoutHeartRate(frng, { ...r, type: 'running' }).map((p) => ({ ...p, value: p.value + (hr - 130) })),
    )
    await bulkMetrics(api, hrPoints)
    for (const run of runs) {
      const id = await addActivity(api, run)
      if (run.title === 'Evening run') {
        await api.post(`/feed/activities/${id}/share`, {
          message: name === 'jonas' ? 'Legs felt fresh today.' : 'Slow and steady.',
          included_metrics: ['duration', 'distance', 'heart_rate_avg', 'calories'],
          series_metrics: ['heart_rate'],
          visibility: 'public',
        })
      }
    }
  }

  // maja shares a run, a strength session and the weekend outing.
  const lastOf = (pred) =>
    [...days]
      .reverse()
      .flatMap((d) => d.workouts)
      .find((w) => pred(w) && w.end <= NOW)
  const shares = [
    [lastOf((w) => w.type === 'strength_training'), 'Legs day done.', { include_exercises: true }],
    [lastOf((w) => w.type === 'biking' || w.type === 'hiking'), 'Crisp morning, empty roads.', {}],
    [
      lastOf((w) => w.type === 'running' && w.title === 'Evening run'),
      'Easy evening loop around Långholmen.',
      {},
    ],
  ]
  for (const [workout, message, extra] of shares) {
    if (!workout) continue
    const id = ids.get(workout)
    await maja.post(`/feed/activities/${id}/share`, {
      ...extra,
      include_chart: true,
      include_map: workout.type !== 'strength_training',
      included_metrics: [
        'duration',
        'distance',
        'heart_rate_avg',
        'heart_rate_max',
        'hr_zone_minutes',
        'calories',
      ],
      message,
      series_metrics: ['heart_rate'],
      visibility: 'public',
    })
  }
  log('feed shares posted')

  const project = process.env.DEMO_COMPOSE_PROJECT
  if (project) {
    await seedSocial({ friendTokens, maja, origin: new URL(challenge.share_url).origin, project })
    // Reading the timeline starts the enrichment of the friends' posts.
    await maja.get('/feed/timeline')
    await sleep(6000)
    await maja.get('/feed/timeline')
    log(`social graph written through docker compose project ${project}`)
  } else {
    log('DEMO_COMPOSE_PROJECT not set: skipping follows, kudos and comments')
  }

  const showcase = [...days]
    .reverse()
    .find((d) => d.eveningRun && d.night && d.i < DAYS - 1 && d.i >= DAYS - LOCATION_DAYS && !d.alcohol)
  const summary = {
    baseUrl: BASE,
    challenge: { name: challenge.name, share_url: challenge.share_url, slug: challenge.slug },
    password: PASSWORD,
    shared_dashboard: dashboard.dashboard.share_url,
    showcase_day: showcase?.key,
    users: ['maja', ...FRIENDS],
  }
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
