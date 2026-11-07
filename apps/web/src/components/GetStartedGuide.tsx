import type { OnboardingStepId, UpdateSettingsInput } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { endOfDay, formatISO, startOfDay, subDays } from 'date-fns'
import { useState } from 'preact/hooks'

import {
  fetchActivityWatchStatus,
  fetchFollowing,
  fetchProductivity,
  fetchRawRecordCount,
  fetchUserSettings,
  listMyChallengeParticipations,
  updateUserSettings,
} from '../state/api'
import { ActivityWatchInstall } from './ActivityWatchInstall'
import {
  countDone,
  type GetStartedInput,
  type GetStartedStep,
  getStartedSteps,
  isGetStartedVisible,
} from './get-started-steps'
import './GetStartedGuide.css'

const SIGNAL_STALE_MS = 10 * 60 * 1000

type DataSignals = Pick<
  GetStartedInput,
  'challengeCount' | 'followingCount' | 'hasDesktopScreenTime' | 'hasHealthConnectData'
>

interface Signal<T> {
  settled: boolean
  value: T
}

const useHealthConnectSignal = (active: boolean): Signal<boolean> => {
  const query = useQuery({
    enabled: active,
    queryFn: () =>
      fetchRawRecordCount({
        source: 'health_connect',
        start: startOfDay(subDays(new Date(), 30)).toISOString(),
      }),
    queryKey: ['getStarted', 'healthConnectRecords'],
    staleTime: SIGNAL_STALE_MS,
  })
  return { settled: !query.isPending, value: (query.data ?? 0) > 0 }
}

const useDesktopScreenTimeSignal = (active: boolean): Signal<boolean> => {
  const start7days = startOfDay(subDays(new Date(), 7))
  const statusQuery = useQuery({
    enabled: active,
    queryFn: fetchActivityWatchStatus,
    queryKey: ['awStatus'],
    staleTime: SIGNAL_STALE_MS,
  })
  // The status lists every pushing device; only the productivity records tell desktop from phone.
  const hasDevices = (statusQuery.data?.length ?? 0) > 0
  const productivityQuery = useQuery({
    enabled: active && hasDevices,
    queryFn: () => fetchProductivity(start7days, endOfDay(new Date())),
    queryKey: ['productivity7days', formatISO(start7days, { representation: 'date' })],
    staleTime: SIGNAL_STALE_MS,
  })
  return {
    settled: !statusQuery.isPending && (!hasDevices || !productivityQuery.isPending),
    value: (productivityQuery.data?.records ?? []).some((r) => r.source === 'activitywatch' && !r.is_mobile),
  }
}

const useSocialSignal = (active: boolean): Signal<{ followingCount: number; challengeCount: number }> => {
  const followingQuery = useQuery({
    enabled: active,
    queryFn: fetchFollowing,
    queryKey: ['following'],
    staleTime: SIGNAL_STALE_MS,
  })
  const followingCount = followingQuery.data?.length ?? 0
  const participationsQuery = useQuery({
    enabled: active && !followingQuery.isPending && followingCount === 0,
    queryFn: listMyChallengeParticipations,
    queryKey: ['challengeParticipations'],
    staleTime: SIGNAL_STALE_MS,
  })
  return {
    settled: !followingQuery.isPending && (followingCount > 0 || !participationsQuery.isPending),
    value: { challengeCount: participationsQuery.data?.length ?? 0, followingCount },
  }
}

/** One call per signal, made only while `active`; `ready` once every call that will run has settled. */
const useDataSignals = (active: boolean): { ready: boolean; signals: DataSignals } => {
  const healthConnect = useHealthConnectSignal(active)
  const screenTime = useDesktopScreenTimeSignal(active)
  const social = useSocialSignal(active)
  return {
    ready: active && healthConnect.settled && screenTime.settled && social.settled,
    signals: {
      ...social.value,
      hasDesktopScreenTime: screenTime.value,
      hasHealthConnectData: healthConnect.value,
    },
  }
}

function StepDescription({ step }: { step: GetStartedStep }) {
  if (step.id !== 'computer_time') return <>{step.description}</>
  return (
    <>
      Install{' '}
      <a href="https://activitywatch.net/" target="_blank" rel="noopener noreferrer">
        ActivityWatch
      </a>
      , then paste this into a terminal. It sends app usage here every 5 minutes.
    </>
  )
}

function StepRow({
  step,
  busy,
  onMarkDone,
}: {
  step: GetStartedStep
  busy: boolean
  onMarkDone: (id: OnboardingStepId) => void
}) {
  return (
    <li class={`get-started-step${step.done ? ' done' : ''}`}>
      <span class="get-started-status" role="img" aria-label={step.done ? 'Done' : 'Not done yet'}>
        {step.done && (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3">
            <path d="M5 12l5 5 9-10" />
          </svg>
        )}
      </span>
      <div class="get-started-body">
        <span class="get-started-title">{step.title}</span>
        <span class="get-started-description">
          <StepDescription step={step} />
        </span>
        {step.id === 'computer_time' && !step.done && (
          <div class="get-started-inline">
            <ActivityWatchInstall manualHref="/data-sources/activitywatch-desktop" />
          </div>
        )}
      </div>
      <div class="get-started-actions">
        {step.action && (
          <a class="get-started-action" href={step.action.href}>
            {step.action.label}
          </a>
        )}
        {step.manual && !step.done && (
          <button type="button" class="get-started-mark" onClick={() => onMarkDone(step.id)} disabled={busy}>
            Mark as done
          </button>
        )}
      </div>
    </li>
  )
}

/** The "Get started" checklist at the top of the dashboard; its signals load only until it is hidden. */
export function GetStartedGuide() {
  const queryClient = useQueryClient()
  const [hiddenNow, setHiddenNow] = useState(false)

  const { data: settings } = useQuery({
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
    staleTime: 5 * 60 * 1000,
  })
  const active = !!settings && !settings.onboarding_dismissed_at && !hiddenNow
  const { ready, signals } = useDataSignals(active)

  const updateMutation = useMutation({
    mutationFn: (update: UpdateSettingsInput) => updateUserSettings(update),
    onSuccess: (data) => queryClient.setQueryData(['userSettings'], data),
  })

  if (!ready || !settings) return null

  const manualDone = settings.onboarding_manual_done
  const input: GetStartedInput = {
    ...signals,
    dismissed: false,
    garminConnected: settings.garmin_connected,
    manualDone,
    ouraConnected: settings.oura_connected,
    stravaConnected: settings.strava_connected,
  }
  const steps = getStartedSteps(input)
  if (!isGetStartedVisible(input, steps)) return null

  const dismiss = () => {
    setHiddenNow(true)
    updateMutation.mutate({ onboarding_dismissed_at: new Date().toISOString() })
  }

  const markDone = (id: OnboardingStepId) =>
    updateMutation.mutate({ onboarding_manual_done: [...manualDone.filter((done) => done !== id), id] })

  return (
    <section class="get-started" aria-labelledby="get-started-title">
      <header class="get-started-header">
        <h2 id="get-started-title">Get started</h2>
        <span class="get-started-count">
          {countDone(steps)} of {steps.length} done
        </span>
      </header>

      <ol class="get-started-steps">
        {steps.map((step) => (
          <StepRow key={step.id} step={step} busy={updateMutation.isPending} onMarkDone={markDone} />
        ))}
      </ol>

      <button type="button" class="get-started-hide" onClick={dismiss}>
        Hide this guide
      </button>
    </section>
  )
}
