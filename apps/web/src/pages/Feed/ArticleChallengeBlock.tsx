/**
 * An article's challenge block: the embedded challenge's race card
 * (`ChallengeRace`) under its name, its caption, and a link to the challenge
 * page, where the join flow is. Two sources, like the other article blocks:
 *
 * - resolved (`TimelineArticle`, visitors and peers): the challenge document and
 *   standings snapshot the structured payload carries; with only the URL (the
 *   origin could not read the challenge), a link card.
 * - live (`ArticleContent`, the owner): a challenge hosted on this instance is
 *   fetched from its public endpoints, as the challenge page does; a remote one
 *   is a link card.
 */
import type { FeedStructuredArticleChallengeBlock } from '@aurboda/api-spec'
import type { ComponentChildren } from 'preact'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'preact/hooks'

import { fetchPublicChallengeStandings, fetchPublicResource } from '../../state/api'
import {
  asStructuredChallenge,
  type ChallengeRaceView,
  challengeHost,
  liveRaceView,
  localChallengeRef,
  structuredRaceView,
} from './challenge-race-view'
import { ChallengeRace } from './ChallengeRace'
import { challengeLink } from './timeline-challenge'
import './ArticleChallengeBlock.css'

const ChallengeFigure = ({ caption, children }: { caption?: string; children: ComponentChildren }) => (
  <figure class="article-challenge">
    {children}
    {caption && <figcaption class="article-chart-caption">{caption}</figcaption>}
  </figure>
)

const RaceCard = ({ view, caption }: { view: ChallengeRaceView; caption?: string }) => (
  <ChallengeFigure caption={caption}>
    <div class="article-challenge-title">
      {view.link ? (
        <a href={view.link} target="_blank" rel="noopener noreferrer">
          {view.name}
        </a>
      ) : (
        view.name
      )}
    </div>
    <ChallengeRace view={view} />
  </ChallengeFigure>
)

/** The challenge as a bare link: what a block shows when its challenge can't be read here. */
const ChallengeLinkCard = ({ url, caption, note }: { url: string; caption?: string; note?: string }) => {
  const link = challengeLink(url)
  const host = challengeHost(url)
  return (
    <ChallengeFigure caption={caption}>
      <div class="article-challenge-title">{host ? `Challenge on ${host}` : 'Challenge'}</div>
      {note && <p class="article-chart-note">{note}</p>}
      {link && (
        <p>
          <a href={link} target="_blank" rel="noopener noreferrer">
            Join / view challenge
          </a>
        </p>
      )}
    </ChallengeFigure>
  )
}

export const ResolvedArticleChallenge = ({ block }: { block: FeedStructuredArticleChallengeBlock }) => {
  const view = useMemo(
    () =>
      block.challenge ? structuredRaceView(asStructuredChallenge(block.challenge, block.standings)) : null,
    [block],
  )
  return view ? (
    <RaceCard view={view} caption={block.caption} />
  ) : (
    <ChallengeLinkCard url={block.url} caption={block.caption} />
  )
}

const LocalArticleChallenge = ({
  url,
  caption,
  username,
  slug,
}: {
  url: string
  caption?: string
  username: string
  slug: string
}) => {
  const resource = useQuery({
    queryFn: () => fetchPublicResource(username, slug),
    queryKey: ['publicResource', username, slug],
    retry: false,
    staleTime: 60 * 1000,
  })
  const challenge = resource.data?.type === 'challenge' ? resource.data.challenge : undefined
  const standings = useQuery({
    enabled: challenge != null,
    queryFn: () => fetchPublicChallengeStandings(username, slug),
    queryKey: ['challengeStandings', username, slug],
    staleTime: 60 * 1000,
  })
  const view = useMemo(
    () => (challenge ? liveRaceView(challenge, standings.data ?? []) : null),
    [challenge, standings.data],
  )
  if (resource.isLoading) return <ChallengeLinkCard url={url} caption={caption} note="Loading challenge…" />
  if (!view) {
    return <ChallengeLinkCard url={url} caption={caption} note="This challenge could not be loaded." />
  }
  return <RaceCard view={view} caption={caption} />
}

export const LiveArticleChallenge = ({ url, caption }: { url: string; caption?: string }) => {
  const local = localChallengeRef(url, window.location.origin)
  return local ? (
    <LocalArticleChallenge url={url} caption={caption} username={local.username} slug={local.slug} />
  ) : (
    <ChallengeLinkCard url={url} caption={caption} />
  )
}
