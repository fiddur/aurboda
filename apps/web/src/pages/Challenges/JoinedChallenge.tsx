/**
 * JoinedChallenge - /challenges/joined/:id, a challenge the user joined as their own server
 * shows it: the host's standings when the host could be read, and the comment thread.
 */
import type { ChallengeParticipation } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useRoute } from 'preact-iso'

import { fetchChallengeThreadAsViewer, fetchJoinedChallenge, leaveChallenge } from '../../state/api'
import '../PublicDashboard/style.css'
import { ChallengeThread } from './ChallengeThread'
import { ChallengeView } from './ChallengeView'
import { hostPageLink } from './joined-link'
import { formatChallengeWindow } from './race-series'
import { describeSpec } from './spec-label'
import './style.css'

function ParticipationSummary({ participation }: { participation: ChallengeParticipation }) {
  return (
    <>
      <div class="dashboard-header">
        <h1>{participation.name}</h1>
        <span class="public-attribution">{participation.host_identity}</span>
      </div>
      <p class="challenge-view-meta">
        {describeSpec(participation.spec)} ({participation.spec.unit}) ·{' '}
        {formatChallengeWindow(participation.start_ts, participation.end_ts, participation.timezone)}
      </p>
      <p class="public-muted">Standings are on the host’s page.</p>
    </>
  )
}

export function JoinedChallenge() {
  const { params } = useRoute()
  const { route } = useLocation()
  const queryClient = useQueryClient()
  const id = params.id as string

  const query = useQuery({
    queryFn: () => fetchJoinedChallenge(id),
    queryKey: ['joinedChallenge', id],
    staleTime: 60 * 1000,
  })

  const leave = useMutation({
    mutationFn: () => leaveChallenge(id),
    onError: () => alert('Failed to leave the challenge.'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['challengeParticipations'] })
      queryClient.removeQueries({ queryKey: ['joinedChallenge', id] })
      route('/challenges')
    },
  })

  if (query.isLoading) {
    return (
      <div class="dashboard public-dashboard public-challenge">
        <p class="public-muted">Loading…</p>
      </div>
    )
  }

  if (query.isError) {
    return (
      <div class="dashboard public-dashboard public-challenge">
        <p class="challenges-empty">{query.error.message}</p>
      </div>
    )
  }

  const data = query.data
  const participation = data?.participation
  if (!data || !participation) {
    return (
      <div class="dashboard public-dashboard public-challenge">
        <h1>Challenge</h1>
        <p class="challenges-empty">
          You are not in this challenge. <a href="/challenges">Your challenges</a>
        </p>
      </div>
    )
  }

  const hostLink = hostPageLink(data.host_page_url)
  const actions = (
    <>
      {hostLink && (
        <a class="btn-secondary" href={hostLink.href} target="_blank" rel="noopener noreferrer">
          Open on {hostLink.host}
        </a>
      )}
      <button
        class="btn-danger"
        disabled={leave.isPending}
        onClick={() => confirm(`Leave "${participation.name}"?`) && leave.mutate()}
      >
        Leave
      </button>
    </>
  )

  return (
    <div class="dashboard public-dashboard public-challenge">
      {data.challenge && data.standings ? (
        <ChallengeView
          challenge={data.challenge}
          standings={data.standings}
          loading={false}
          attribution={<span class="public-attribution">{participation.host_identity}</span>}
          actions={actions}
        />
      ) : (
        <>
          <ParticipationSummary participation={participation} />
          <div class="challenge-view-actions">{actions}</div>
        </>
      )}

      <ChallengeThread
        challengeUrl={participation.challenge_url}
        queryKey={['challengeThread', 'joined', id]}
        fetchPage={(cursor) => fetchChallengeThreadAsViewer(participation.challenge_url, cursor)}
      />
    </div>
  )
}
