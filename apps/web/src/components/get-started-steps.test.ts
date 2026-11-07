import { describe, expect, test } from 'vitest'

import { countDone, type GetStartedInput, getStartedSteps, isGetStartedVisible } from './get-started-steps'

const fresh: GetStartedInput = {
  challengeCount: 0,
  dismissed: false,
  followingCount: 0,
  garminConnected: false,
  hasDesktopScreenTime: false,
  hasHealthConnectData: false,
  manualDone: [],
  ouraConnected: false,
  stravaConnected: false,
}

const doneIds = (input: GetStartedInput) =>
  getStartedSteps(input)
    .filter((step) => step.done)
    .map((step) => step.id)

describe('getStartedSteps', () => {
  test('lists the five steps in order, none done for a new account', () => {
    const steps = getStartedSteps(fresh)

    expect(steps.map((step) => step.id)).toEqual([
      'android_app',
      'wearable',
      'computer_time',
      'social',
      'ask_ai',
    ])
    expect(countDone(steps)).toBe(0)
  })

  test.each<[string, Partial<GetStartedInput>, string]>([
    ['Health Connect data', { hasHealthConnectData: true }, 'android_app'],
    ['Garmin connected', { garminConnected: true }, 'wearable'],
    ['Oura connected', { ouraConnected: true }, 'wearable'],
    ['Strava connected', { stravaConnected: true }, 'wearable'],
    ['desktop screen time', { hasDesktopScreenTime: true }, 'computer_time'],
    ['following someone', { followingCount: 2 }, 'social'],
    ['in a challenge', { challengeCount: 1 }, 'social'],
    ['asking the AI marked done', { manualDone: ['ask_ai'] }, 'ask_ai'],
  ])('%s completes only its step', (_name, signal, id) => {
    expect(doneIds({ ...fresh, ...signal })).toEqual([id])
  })

  test('only the AI step is marked by hand', () => {
    expect(
      getStartedSteps(fresh)
        .filter((step) => step.manual)
        .map((step) => step.id),
    ).toEqual(['ask_ai'])
  })

  test('the computer step has no link of its own: the installer sits in the row', () => {
    const steps = getStartedSteps(fresh)
    expect(steps.find((step) => step.id === 'computer_time')?.action).toBeUndefined()
    expect(steps.filter((step) => step.id !== 'computer_time').every((step) => step.action)).toBe(true)
  })
})

describe('isGetStartedVisible', () => {
  const allDone: GetStartedInput = {
    ...fresh,
    followingCount: 1,
    hasDesktopScreenTime: true,
    hasHealthConnectData: true,
    manualDone: ['ask_ai'],
    stravaConnected: true,
  }

  test('shows while any step is left', () => {
    expect(isGetStartedVisible(fresh, getStartedSteps(fresh))).toBe(true)
    const almost = { ...allDone, manualDone: [] }
    expect(isGetStartedVisible(almost, getStartedSteps(almost))).toBe(true)
  })

  test('hides once all five are done', () => {
    expect(isGetStartedVisible(allDone, getStartedSteps(allDone))).toBe(false)
  })

  test('hides once dismissed', () => {
    const dismissed = { ...fresh, dismissed: true }
    expect(isGetStartedVisible(dismissed, getStartedSteps(dismissed))).toBe(false)
  })
})
