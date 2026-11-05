import { useQuery } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'

/**
 * PublicPost - one public/unlisted feed post at /u/:username/posts/:postId, the
 * page a federated Note's id URL redirects a browser to. Unauthenticated;
 * rendered without app chrome.
 */
import { avatarUrl, fetchPublicPost } from '../../state/api'
import { FeedPostCard } from '../Feed/FeedPostCard'
import { publicAuthor } from '../PublicProfile/public-author'
import '../PublicProfile/style.css'
import './style.css'

export function PublicPost() {
  const { params } = useRoute()
  const { postId, username } = params
  const profileUrl = `/u/${encodeURIComponent(username)}`

  const query = useQuery({
    queryFn: () => fetchPublicPost(username, postId),
    queryKey: ['publicPost', username, postId],
    retry: false,
    staleTime: 60 * 1000,
  })

  if (query.isLoading) {
    return (
      <div class="public-profile">
        <div class="public-loading">Loading…</div>
      </div>
    )
  }

  const post = query.data?.success ? query.data.post : undefined
  if (query.isError || !post) {
    return (
      <div class="public-profile">
        <h1>Post not found</h1>
        <p class="public-muted">This post doesn't exist or isn't public.</p>
        <p>
          <a href={profileUrl}>@{username}</a>
        </p>
      </div>
    )
  }

  return (
    <div class="public-profile">
      <a class="public-profile-header public-post-author" href={profileUrl}>
        <img
          class="public-avatar"
          src={avatarUrl(username)}
          alt={`${username}'s avatar`}
          width={80}
          height={80}
        />
        <h1>@{username}</h1>
      </a>

      <FeedPostCard post={post} author={publicAuthor(username)} visitor />
    </div>
  )
}
