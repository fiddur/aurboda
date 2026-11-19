/**
 * A hosted challenge as an ActivityStreams object (`docs/fep/quantpub-challenges.md` §2):
 * an `Event` dual-typed `quant:Challenge`, carrying the FEP-8a8e `timezone` and
 * `joinMode` and the `quant:` terms of the HTTP challenge document. Every value
 * comes from `buildChallengeListItem`, so the object and the document never disagree.
 */
import type { Context } from '@fedify/fedify'

import { Event } from '@fedify/fedify/vocab'

import type { ChallengeRecord } from '../../db/index.ts'

import { describeChallenge } from '../challenge-card.ts'
import { buildChallengeListItem, challengeApiUrl, type HostContext } from '../challenge-quantpub.ts'
import { escapeXml } from '../charts/chart-svg.ts'
import { AS_PUBLIC } from './object.ts'
import { withQuantJsonLd } from './quant-extension.ts'
import { dateToTemporalInstant } from './temporal-interop.ts'

/** Inline FEP-8a8e term definitions, so no consumer has to fetch the remote context to read them. */
export type Fep8a8eContextEntry = {
  readonly joinMode: string
  readonly timezone: string
}

export const fep8a8eContextEntry: Fep8a8eContextEntry = Object.freeze({
  joinMode: 'https://w3id.org/fep/8a8e/joinMode',
  timezone: 'https://w3id.org/fep/8a8e/timezone',
})

export const CHALLENGE_OBJECT_TYPE = 'quant:Challenge'

/** The FEP-8a8e and `quant:` terms spliced into the serialized `Event`. */
export const challengeEventExtension = (
  challenge: ChallengeRecord,
  host: HostContext,
): Record<string, unknown> => {
  const item = buildChallengeListItem(challenge, host)
  return {
    joinMode: item.joinMode,
    'quant:bucket': item.bucket,
    'quant:metric': item.metric,
    'quant:scoring': item.scoring,
    'quant:structuredUrl': challengeApiUrl(host, challenge.slug),
    'quant:unit': item.unit,
    timezone: item.timezone,
  }
}

/**
 * The `content` a plain client shows: the name, what is measured over which
 * dates, and the page. Nothing that changes with a sync or names a member: an
 * unlisted challenge resolves for anyone holding its slug.
 */
export const renderChallengeEventHtml = (challenge: ChallengeRecord, pageUrl: string, now: Date): string => {
  const { measure, range } = describeChallenge(
    {
      banner_updated_at: null,
      end_ts: challenge.end_ts.toISOString(),
      id: challenge.id,
      is_public: challenge.is_public,
      members: [],
      name: challenge.name,
      spec: challenge.spec,
      start_ts: challenge.start_ts.toISOString(),
      timezone: challenge.timezone,
    },
    now,
  )
  const page = escapeXml(pageUrl)
  return [
    `<p><strong>${escapeXml(challenge.name)}</strong></p>`,
    `<p>${escapeXml(measure)} · ${escapeXml(range)}</p>`,
    `<p><a href="${page}" rel="nofollow noopener noreferrer" target="_blank">${page}</a></p>`,
  ].join('\n')
}

/** The challenge's `Event`, wrapped so its JSON-LD carries the dual type and the extension terms. */
export const buildChallengeEvent = (
  ctx: Context<void>,
  identifier: string,
  challenge: ChallengeRecord,
  host: Omit<HostContext, 'username'>,
): Event => {
  const hostCtx: HostContext = { ...host, username: identifier }
  const { url } = buildChallengeListItem(challenge, hostCtx)
  const event = new Event({
    attribution: ctx.getActorUri(identifier),
    content: renderChallengeEventHtml(challenge, url, hostCtx.now),
    endTime: dateToTemporalInstant(challenge.end_ts),
    id: ctx.getObjectUri(Event, { identifier, slug: challenge.slug }),
    name: challenge.name,
    published: dateToTemporalInstant(challenge.created_at),
    startTime: dateToTemporalInstant(challenge.start_ts),
    tos: challenge.is_public ? [new URL(AS_PUBLIC)] : [],
    updated: dateToTemporalInstant(challenge.updated_at),
    url: new URL(url),
  })
  return withQuantJsonLd(event, challengeEventExtension(challenge, hostCtx), {
    extraContext: fep8a8eContextEntry,
    type: CHALLENGE_OBJECT_TYPE,
  })
}
