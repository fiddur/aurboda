/**
 * Challenges - manage challenges you host and ones you've joined.
 *
 * Create a competition on a metric or activity type over a date range (public or
 * unlisted), copy its link, delete it; join a challenge by URL (local or on
 * another Aurboda instance). Federation happens server-side.
 */
import type {
  Challenge,
  ChallengeBucketSizeChoice,
  ChallengeParticipation,
  CreateChallengeBody,
  ShareVisibility,
} from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { ActivityTypePicker } from '../../components/ActivityTypePicker'
import { MetricPicker } from '../../components/MetricPicker'
import { SHARE_VISIBILITY_OPTIONS, VisibilitySelector } from '../../components/VisibilitySelector'
import {
  createChallenge,
  deleteChallenge,
  joinChallengeByUrl,
  leaveChallenge,
  listChallenges,
  listMyChallengeParticipations,
} from '../../state/api'
import {
  browserTz,
  dateToEndIso,
  dateToStartIso,
  defaultWeekRange,
  thisMonthRange,
  thisWeekRange,
} from './date-range'
import './style.css'

function CreateChallengeForm({ onCreated }: { onCreated: () => void }) {
  const initialRange = defaultWeekRange()
  const [name, setName] = useState('')
  const [sourceType, setSourceType] = useState<'metric' | 'activity_type'>('metric')
  const [pattern, setPattern] = useState('')
  const [aggregation, setAggregation] = useState<'sum' | 'count'>('sum')
  const [unit, setUnit] = useState('')
  const [startDate, setStartDate] = useState(initialRange.start)
  const [endDate, setEndDate] = useState(initialRange.end)
  const [bucketSize, setBucketSize] = useState<ChallengeBucketSizeChoice>('auto')
  const [visibility, setVisibility] = useState<ShareVisibility>('unlisted')

  const createMutation = useMutation({
    mutationFn: (body: CreateChallengeBody) => createChallenge(body),
    onError: () => alert('Failed to create the challenge. Please try again.'),
    onSuccess: () => {
      setName('')
      setPattern('')
      setUnit('')
      onCreated()
    },
  })

  const applyRange = ({ start, end }: { start: string; end: string }) => {
    setStartDate(start)
    setEndDate(end)
  }

  const canSubmit = name.trim() && pattern.trim() && unit.trim() && !createMutation.isPending

  const handleSubmit = (e: Event) => {
    e.preventDefault()
    if (!canSubmit) return
    createMutation.mutate({
      end_ts: dateToEndIso(endDate),
      name: name.trim(),
      spec: {
        aggregation,
        bucket_size: bucketSize,
        pattern: pattern.trim(),
        source_type: sourceType,
        unit: unit.trim(),
      },
      start_ts: dateToStartIso(startDate),
      timezone: browserTz(),
      visibility,
    })
  }

  return (
    <form class="challenge-create" onSubmit={handleSubmit}>
      <h2>New challenge</h2>
      <label>
        Name
        <input type="text" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      </label>

      <label>
        Measures
        <select
          value={sourceType}
          onChange={(e) => {
            setSourceType((e.target as HTMLSelectElement).value as 'metric' | 'activity_type')
            setPattern('')
          }}
        >
          <option value="metric">Metric</option>
          <option value="activity_type">Activity type</option>
        </select>
      </label>

      <label>
        {sourceType === 'metric' ? 'Metric' : 'Activity type'}
        {sourceType === 'metric' ? (
          <MetricPicker value={pattern} onChange={setPattern} />
        ) : (
          <ActivityTypePicker value={pattern} onChange={setPattern} />
        )}
      </label>

      <div class="challenge-create-row">
        <label>
          Aggregation
          <select
            value={aggregation}
            onChange={(e) => setAggregation((e.target as HTMLSelectElement).value as 'sum' | 'count')}
          >
            <option value="sum">Sum</option>
            <option value="count">Count</option>
          </select>
        </label>
        <label>
          Unit
          <input
            type="text"
            value={unit}
            placeholder={sourceType === 'metric' ? 'e.g. steps' : 'e.g. hours'}
            onInput={(e) => setUnit((e.target as HTMLInputElement).value)}
          />
        </label>
      </div>

      <div class="challenge-create-row">
        <label>
          From
          <input
            type="date"
            value={startDate}
            onInput={(e) => setStartDate((e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={endDate}
            onInput={(e) => setEndDate((e.target as HTMLInputElement).value)}
          />
        </label>
      </div>
      <div class="challenge-quick-spans">
        <button type="button" class="btn-secondary" onClick={() => applyRange(thisWeekRange())}>
          This week
        </button>
        <button type="button" class="btn-secondary" onClick={() => applyRange(thisMonthRange())}>
          This month
        </button>
      </div>

      <label>
        Chart detail
        <select
          value={bucketSize}
          onChange={(e) => setBucketSize((e.target as HTMLSelectElement).value as ChallengeBucketSizeChoice)}
        >
          <option value="auto">Auto (adapts to the date range)</option>
          <option value="1d">Daily</option>
          <option value="1w">Weekly</option>
          <option value="1M">Monthly</option>
        </select>
      </label>

      <VisibilitySelector
        name="challenge-visibility"
        options={SHARE_VISIBILITY_OPTIONS}
        value={visibility}
        onChange={setVisibility}
      />

      <button type="submit" class="btn-primary" disabled={!canSubmit}>
        Create challenge
      </button>
    </form>
  )
}

function HostedRow({ challenge }: { challenge: Challenge }) {
  const queryClient = useQueryClient()
  const [copied, setCopied] = useState(false)
  const del = useMutation({
    mutationFn: () => deleteChallenge(challenge.id),
    onError: () => alert('Failed to delete the challenge.'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['challenges'] }),
  })

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(challenge.share_url)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      } else window.prompt('Copy this link:', challenge.share_url)
    } catch {
      window.prompt('Copy this link:', challenge.share_url)
    }
  }

  return (
    <li class="challenge-row">
      <div class="challenge-row-main">
        <a class="challenge-row-name" href={challenge.share_url}>
          {challenge.name}
        </a>
        <span class="challenge-row-meta">
          {challenge.spec.pattern} · {challenge.spec.aggregation} · {challenge.visibility}
        </span>
      </div>
      <div class="challenge-row-actions">
        <a class="btn-secondary" href={challenge.share_url}>
          View
        </a>
        <button class="btn-secondary" onClick={copy}>
          {copied ? 'Copied!' : 'Copy link'}
        </button>
        <button class="btn-danger" onClick={() => confirm(`Delete "${challenge.name}"?`) && del.mutate()}>
          Delete
        </button>
      </div>
    </li>
  )
}

function JoinedRow({ participation }: { participation: ChallengeParticipation }) {
  const queryClient = useQueryClient()
  const leave = useMutation({
    mutationFn: () => leaveChallenge(participation.id),
    onError: () => alert('Failed to leave the challenge.'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['challengeParticipations'] }),
  })

  return (
    <li class="challenge-row">
      <div class="challenge-row-main">
        <a class="challenge-row-name" href={participation.challenge_url}>
          {participation.name}
        </a>
        <span class="challenge-row-meta">{participation.host_identity}</span>
      </div>
      <div class="challenge-row-actions">
        <a class="btn-secondary" href={participation.challenge_url}>
          View
        </a>
        <button
          class="btn-danger"
          onClick={() => confirm(`Leave "${participation.name}"?`) && leave.mutate()}
        >
          Leave
        </button>
      </div>
    </li>
  )
}

export function Challenges() {
  const queryClient = useQueryClient()
  const [joinUrl, setJoinUrl] = useState('')

  const hostedQuery = useQuery({ queryFn: listChallenges, queryKey: ['challenges'], staleTime: 60_000 })
  const joinedQuery = useQuery({
    queryFn: listMyChallengeParticipations,
    queryKey: ['challengeParticipations'],
    staleTime: 60_000,
  })

  const joinMutation = useMutation({
    mutationFn: (url: string) => joinChallengeByUrl(url),
    onError: (e) => alert(e instanceof Error ? e.message : 'Failed to join the challenge.'),
    onSuccess: () => {
      setJoinUrl('')
      queryClient.invalidateQueries({ queryKey: ['challengeParticipations'] })
    },
  })

  const hosted = hostedQuery.data ?? []
  const joined = joinedQuery.data ?? []

  return (
    <div class="challenges-page">
      <h1>Challenges</h1>
      <p class="challenges-intro">
        Compete with others on a metric or activity type over a date range — including people on other Aurboda
        instances. Public challenges are listed on your profile; unlisted ones are reachable only by their
        link.
      </p>

      <div class="challenges-join">
        <input
          type="text"
          value={joinUrl}
          placeholder="Paste a challenge URL to join…"
          onInput={(e) => setJoinUrl((e.target as HTMLInputElement).value)}
        />
        <button
          class="btn-primary"
          disabled={!joinUrl.trim() || joinMutation.isPending}
          onClick={() => joinMutation.mutate(joinUrl.trim())}
        >
          Join
        </button>
      </div>

      <div class="challenges-columns">
        <section>
          <h2>Hosted by you</h2>
          {hosted.length === 0 ? (
            <p class="challenges-empty">You haven’t created any challenges yet.</p>
          ) : (
            <ul class="challenge-list">
              {hosted.map((c) => (
                <HostedRow key={c.id} challenge={c} />
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2>Joined</h2>
          {joined.length === 0 ? (
            <p class="challenges-empty">You haven’t joined any challenges yet.</p>
          ) : (
            <ul class="challenge-list">
              {joined.map((p) => (
                <JoinedRow key={p.id} participation={p} />
              ))}
            </ul>
          )}
        </section>
      </div>

      <CreateChallengeForm onCreated={() => queryClient.invalidateQueries({ queryKey: ['challenges'] })} />
    </div>
  )
}
