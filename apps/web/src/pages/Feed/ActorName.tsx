import { actorProfileLink } from './profile-link'

/**
 * An actor's display name, linked to their profile: the local `/u/:username`
 * page for a local actor, or their own (remote) URL — opened externally (a new
 * tab in the browser, the system browser from the embedded app) — for a
 * fediverse actor on another instance. Falls back to plain text when the actor
 * URI isn't linkable.
 */
export const ActorName = ({ name, actorUri }: { name: string; actorUri: string }) => {
  const link = actorProfileLink(actorUri, window.location.host)
  if (!link) return <>{name}</>
  return link.external ? (
    <a href={link.href} target="_blank" rel="noopener noreferrer">
      {name}
    </a>
  ) : (
    <a href={link.href}>{name}</a>
  )
}
