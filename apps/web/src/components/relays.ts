import type { Relay, RelayState, RelayStyle } from '@aurboda/api-spec'

/** The tags.pub relay: a Mastodon-style relay inbox that takes posts and never sends any. */
export const TAGS_PUB_RELAY: { url: string; style: RelayStyle } = {
  style: 'mastodon',
  url: 'https://tags.pub/user/_____relay_____/inbox',
}

const STATE_LABELS: Record<RelayState, string> = {
  accepted: 'Accepted',
  pending: 'Pending',
  rejected: 'Rejected',
}

export const relayStateLabel = (state: RelayState): string => STATE_LABELS[state]

export const relayStyleLabel = (style: RelayStyle): string => (style === 'litepub' ? 'LitePub' : 'Mastodon')

export const relayStateTitle = (relay: Pick<Relay, 'last_error' | 'state'>): string =>
  relay.last_error ?? relayStateLabel(relay.state)

export const hasTagsPubRelay = (relays: readonly Pick<Relay, 'url'>[]): boolean =>
  relays.some((relay) => relay.url === TAGS_PUB_RELAY.url)
