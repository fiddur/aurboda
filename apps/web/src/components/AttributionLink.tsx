import { avatarUrl } from '../state/api'

/** Author attribution (avatar + @handle), shared by every public page so they can't drift apart (#879). */
export function AttributionLink({ username }: { username: string }) {
  return (
    <a class="public-attribution" href={`/u/${encodeURIComponent(username)}`}>
      <img class="public-attribution__avatar" src={avatarUrl(username)} alt="" width={28} height={28} />@
      {username}
    </a>
  )
}
