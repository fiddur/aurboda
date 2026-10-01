import type { ChallengeSourceType } from '@aurboda/api-spec'

export interface ChallengeTheme {
  emoji: string
  /** 135° gradient stops, dark → mid → light. */
  gradient: [string, string, string]
  key: string
}

interface ThemeRule extends ChallengeTheme {
  test: RegExp
}

// Ordered: the first match wins. Body `weight` deliberately matches nothing
// (only `weight_training` is strength), so it falls through to the default.
const THEME_RULES: ThemeRule[] = [
  { emoji: '👣', gradient: ['#064e3b', '#0f766e', '#2dd4bf'], key: 'steps', test: /step/ },
  { emoji: '🏃', gradient: ['#7c2d12', '#ea580c', '#fdba74'], key: 'running', test: /\brun|jog/ },
  {
    emoji: '🚴',
    gradient: ['#1e3a8a', '#2563eb', '#93c5fd'],
    key: 'cycling',
    test: /cycl|bike|biking|ride|riding/,
  },
  { emoji: '🏊', gradient: ['#164e63', '#0891b2', '#67e8f9'], key: 'swimming', test: /swim/ },
  { emoji: '🥾', gradient: ['#365314', '#4d7c0f', '#bef264'], key: 'hiking', test: /hik|walk/ },
  {
    emoji: '🏔️',
    gradient: ['#1f2937', '#475569', '#cbd5e1'],
    key: 'climbing',
    test: /floor|climb|elevation|stair/,
  },
  {
    emoji: '🏋️',
    gradient: ['#7f1d1d', '#dc2626', '#fca5a5'],
    key: 'strength',
    test: /strength|gym|lift|weight_training|crossfit/,
  },
  {
    emoji: '🧘',
    gradient: ['#581c87', '#9333ea', '#e9d5ff'],
    key: 'yoga',
    test: /yoga|stretch|pilates|mobility/,
  },
  { emoji: '😴', gradient: ['#1e1b4b', '#4338ca', '#a5b4fc'], key: 'sleep', test: /sleep/ },
  {
    emoji: '❤️‍🔥',
    gradient: ['#881337', '#e11d48', '#fda4af'],
    key: 'heart',
    test: /heart|hr_zone|zone|intensity|cardio/,
  },
  { emoji: '🔥', gradient: ['#7c2d12', '#c2410c', '#fed7aa'], key: 'calories', test: /calor|energy/ },
  { emoji: '🧭', gradient: ['#0c4a6e', '#0284c7', '#bae6fd'], key: 'distance', test: /distance|km|mile/ },
  { emoji: '⛷️', gradient: ['#0f172a', '#334155', '#e0f2fe'], key: 'skiing', test: /ski|snowboard/ },
  { emoji: '🚣', gradient: ['#134e4a', '#0d9488', '#99f6e4'], key: 'rowing', test: /row|kayak|paddle|canoe/ },
]

export const DEFAULT_CHALLENGE_THEME: ChallengeTheme = {
  emoji: '🏆',
  gradient: ['#4c1d95', '#673ab8', '#8b5cf6'],
  key: 'default',
}

/** Pick a card theme from what the challenge measures (metric name or activity type). */
export const challengeTheme = (spec: {
  source_type: ChallengeSourceType
  pattern: string
}): ChallengeTheme => {
  const pattern = spec.pattern.toLowerCase()
  const rule = THEME_RULES.find(({ test }) => test.test(pattern))
  return rule ? { emoji: rule.emoji, gradient: rule.gradient, key: rule.key } : DEFAULT_CHALLENGE_THEME
}
