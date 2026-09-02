/**
 * Challenges - manage challenges you host and ones you've joined.
 *
 * The list is grouped by time status — Ongoing first and most prominent, then
 * Upcoming, with Ended tucked into a collapsed section — so what needs
 * attention right now is unmissable. Create a competition on a metric or
 * activity type over a date range (public or unlisted), copy its link, delete
 * it; join a challenge by URL (local or on another Aurboda instance).
 * Federation happens server-side.
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
import { ShareChallengeDialog } from '../../components/ShareChallengeDialog'
import { SHARE_VISIBILITY_OPTIONS, VisibilitySelector } from '../../components/VisibilitySelector'
import {
  createChallenge,
  deleteChallenge,
  joinChallengeByUrl,
  leaveChallenge,
  listChallenges,
  listMyChallengeParticipations,
  updateChallenge,
} from '../../state/api'
import {
  type ChallengeItem,
  challengeItemKey,
  challengeRangeLabel,
  challengeTimePhrase,
  challengeTimeStatus,
  groupChallengeItems,
} from './challenge-status'
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
  const [announceWinner, setAnnounceWinner] = useState(true)

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
      announce_winner: announceWinner,
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

      <label class="challenge-checkbox">
        <input
          type="checkbox"
          checked={announceWinner}
          onChange={(e) => setAnnounceWinner((e.target as HTMLInputElement).checked)}
        />
        <span>
          Announce the winner to my feed when it ends
          <small>Posts the final standings, tagging the winner. You can change this later.</small>
        </span>
      </label>

      <button type="submit" class="btn-primary" disabled={!canSubmit}>
        Create challenge
      </button>
    </form>
  )
}

function RowMain({
  endTs,
  meta,
  name,
  now,
  role,
  startTs,
  timezone,
  url,
}: {
  endTs: string
  meta: string
  name: string
  now: Date
  role: 'hosted' | 'joined'
  startTs: string
  timezone: string
  url: string
}) {
  const status = challengeTimeStatus(startTs, endTs, now)
  return (
    <div class="challenge-row-main">
      <div class="challenge-row-title">
        <a class="challenge-row-name" href={url}>
          {name}
        </a>
        <span class={`challenge-row-badge challenge-row-badge-${role}`}>
          {role === 'hosted' ? 'Hosted by you' : 'Joined'}
        </span>
      </div>
      <span class="challenge-row-meta">{meta}</span>
      <span class="challenge-row-dates">
        <span class={`challenge-row-phrase challenge-row-phrase-${status}`}>
          {challengeTimePhrase(startTs, endTs, timezone, now)}
        </span>
        {' · '}
        {challengeRangeLabel(startTs, endTs, timezone)}
      </span>
    </div>
  )
}

function HostedRow({ challenge, now }: { challenge: Challenge; now: Date }) {
  const queryClient = useQueryClient()
  const [copied, setCopied] = useState(false)
  const [sharing, setSharing] = useState(false)
  const del = useMutation({
    mutationFn: () => deleteChallenge(challenge.id),
    onError: () => alert('Failed to delete the challenge.'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['challenges'] }),
  })
  const announce = useMutation({
    mutationFn: (announce_winner: boolean) => updateChallenge(challenge.id, { announce_winner }),
    onError: () => alert('Failed to update the challenge.'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['challenges'] }),
  })
  // The announcement is made a grace period after the window closes, and the
  // setting matters right up to then — so gate on the announcement itself
  // (or its deliberate skip) having happened, not on the end date.
  const canToggleAnnounce = !challenge.result_published_at

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
      <RowMain
        endTs={challenge.end_ts}
        meta={`${challenge.spec.pattern} · ${challenge.spec.aggregation} · ${challenge.visibility}`}
        name={challenge.name}
        now={now}
        role="hosted"
        startTs={challenge.start_ts}
        timezone={challenge.timezone}
        url={challenge.share_url}
      />
      <div class="challenge-row-actions">
        <a class="btn-secondary" href={challenge.share_url}>
          View
        </a>
        <button class="btn-secondary" onClick={copy}>
          {copied ? 'Copied!' : 'Copy link'}
        </button>
        <button class="btn-secondary" onClick={() => setSharing(true)}>
          Share to feed
        </button>
        <button class="btn-danger" onClick={() => confirm(`Delete "${challenge.name}"?`) && del.mutate()}>
          Delete
        </button>
        {canToggleAnnounce && (
          <label
            class="challenge-row-toggle"
            title="Post the final standings to your feed when the challenge ends"
          >
            <input
              type="checkbox"
              checked={challenge.announce_winner}
              disabled={announce.isPending}
              onChange={(e) => announce.mutate((e.target as HTMLInputElement).checked)}
            />
            Announce winner
          </label>
        )}
      </div>
      {sharing && (
        <ShareChallengeDialog
          challengeId={challenge.id}
          challengeName={challenge.name}
          challengeUrl={challenge.share_url}
          onClose={() => setSharing(false)}
        />
      )}
    </li>
  )
}

function JoinedRow({ now, participation }: { now: Date; participation: ChallengeParticipation }) {
  const queryClient = useQueryClient()
  const [sharing, setSharing] = useState(false)
  const leave = useMutation({
    mutationFn: () => leaveChallenge(participation.id),
    onError: () => alert('Failed to leave the challenge.'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['challengeParticipations'] }),
  })

  return (
    <li class="challenge-row">
      <RowMain
        endTs={participation.end_ts}
        meta={participation.host_identity}
        name={participation.name}
        now={now}
        role="joined"
        startTs={participation.start_ts}
        timezone={participation.timezone}
        url={participation.challenge_url}
      />
      <div class="challenge-row-actions">
        <a class="btn-secondary" href={participation.challenge_url}>
          View
        </a>
        <button class="btn-secondary" onClick={() => setSharing(true)}>
          Share to feed
        </button>
        <button
          class="btn-danger"
          onClick={() => confirm(`Leave "${participation.name}"?`) && leave.mutate()}
        >
          Leave
        </button>
      </div>
      {sharing && (
        <ShareChallengeDialog
          participationId={participation.id}
          challengeName={participation.name}
          challengeUrl={participation.challenge_url}
          onClose={() => setSharing(false)}
        />
      )}
    </li>
  )
}

function ChallengeRows({ items, now }: { items: ChallengeItem[]; now: Date }) {
  return (
    <ul class="challenge-list">
      {items.map((item) =>
        item.kind === 'hosted' ? (
          <HostedRow key={challengeItemKey(item)} challenge={item.challenge} now={now} />
        ) : (
          <JoinedRow key={challengeItemKey(item)} now={now} participation={item.participation} />
        ),
      )}
    </ul>
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
  const loading = hostedQuery.isLoading || joinedQuery.isLoading
  const now = new Date()
  const groups = groupChallengeItems(hosted, joined, now)

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

      <section class="challenge-group challenge-group-ongoing">
        <h2>
          <span class="challenge-ongoing-dot" aria-hidden="true" />
          Ongoing
          {groups.ongoing.length > 0 && <span class="challenge-group-count">{groups.ongoing.length}</span>}
        </h2>
        {groups.ongoing.length > 0 ? (
          <ChallengeRows items={groups.ongoing} now={now} />
        ) : (
          <p class="challenges-empty">
            {loading
              ? 'Loading…'
              : 'No ongoing challenges — join one by link above or create your own below.'}
          </p>
        )}
      </section>

      {groups.upcoming.length > 0 && (
        <section class="challenge-group">
          <h2>Upcoming</h2>
          <ChallengeRows items={groups.upcoming} now={now} />
        </section>
      )}

      {groups.ended.length > 0 && (
        <details class="challenge-group challenge-group-ended">
          <summary>
            <h2>Ended ({groups.ended.length})</h2>
          </summary>
          <ChallengeRows items={groups.ended} now={now} />
        </details>
      )}

      <CreateChallengeForm onCreated={() => queryClient.invalidateQueries({ queryKey: ['challenges'] })} />
    </div>
  )
}
