import type { OnboardingStepId } from '@aurboda/api-spec'

export interface GetStartedInput {
  dismissed: boolean
  manualDone: readonly OnboardingStepId[]
  hasHealthConnectData: boolean
  garminConnected: boolean
  ouraConnected: boolean
  stravaConnected: boolean
  hasDesktopScreenTime: boolean
  followingCount: number
  challengeCount: number
}

export interface GetStartedStep {
  id: OnboardingStepId
  title: string
  description: string
  /** Absent where the row carries its own inline setup (the ActivityWatch installer). */
  action?: { label: string; href: string }
  done: boolean
  /** Aurboda cannot see this step happen, so the user marks it done. */
  manual: boolean
}

export const getStartedSteps = (input: GetStartedInput): GetStartedStep[] => {
  const markedDone = (id: OnboardingStepId) => input.manualDone.includes(id)
  return [
    {
      action: { href: '/data-sources/android-app', label: 'Get the app' },
      description: 'Steps, sleep, heart rate and workouts from Health Connect.',
      done: input.hasHealthConnectData,
      id: 'android_app',
      manual: false,
      title: 'Install the Android app',
    },
    {
      action: { href: '/data-sources', label: 'Connect' },
      description: 'Garmin, Oura or Strava, one click each.',
      done: input.garminConnected || input.ouraConnected || input.stravaConnected,
      id: 'wearable',
      manual: false,
      title: 'Connect your watch or ring',
    },
    {
      description:
        'Install ActivityWatch, then paste this into a terminal. It sends app usage here every 5 minutes.',
      done: input.hasDesktopScreenTime,
      id: 'computer_time',
      manual: false,
      title: 'Track time at your computer',
    },
    {
      action: { href: '/feed', label: 'Find people' },
      description: 'Your feed shows people you follow.',
      done: input.followingCount > 0 || input.challengeCount > 0,
      id: 'social',
      manual: false,
      title: 'Follow a friend or join a challenge',
    },
    {
      action: { href: '/data-sources/aurboda#ai-assistant', label: 'Show me how' },
      description: "Connect Claude or another AI assistant, then ask 'did I sleep better on days I ran?'",
      done: markedDone('ask_ai'),
      id: 'ask_ai',
      manual: true,
      title: 'Ask your data questions',
    },
  ]
}

export const countDone = (steps: readonly GetStartedStep[]): number => steps.filter((s) => s.done).length

export const isGetStartedVisible = (input: GetStartedInput, steps: readonly GetStartedStep[]): boolean =>
  !input.dismissed && countDone(steps) < steps.length
