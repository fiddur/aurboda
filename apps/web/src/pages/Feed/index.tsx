/**
 * Feed page: the article composer and drafts first, then the home timeline or
 * your own posts (rendered as the native cards followers see, each with Edit /
 * Unshare), and the follow / follower / auto-share management at the bottom.
 */
import type { ArticleDraft, FeedPost, FeedPostsResponse } from '@aurboda/api-spec'
import type { InfiniteData } from '@tanstack/react-query'

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useState } from 'preact/hooks'

import { ArticleEditorDialog } from '../../components/ArticleEditorDialog'
import { ArticleExportDialog } from '../../components/ArticleExportDialog'
import { ShareActivityDialog } from '../../components/ShareActivityDialog'
import { avatarUrl, deleteFeedPost, fetchFeed } from '../../state/api'
import { auth } from '../../state/auth'
import { ArticleDrafts } from './ArticleDrafts'
import { AutoShareRulesPanel } from './AutoShareRulesPanel'
import { type FeedTab, feedTabFromQuery, feedTabUrl } from './feed-tab'
import { FeedPostCard, type PostAuthor } from './FeedPostCard'
import { FollowedTagsPanel } from './FollowedTagsPanel'
import { FollowersPanel } from './FollowersPanel'
import { FollowingPanel } from './FollowingPanel'
import { HomeTimeline } from './HomeTimeline'
import { PostReactionSummary } from './PostReactions'
import { PostReplySummary } from './PostReplies'
import './style.css'

function OwnPostCard({ post, author }: { post: FeedPost; author: PostAuthor }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const activityId = post.activity_id
  const isArticle = post.kind === 'article'

  const deleteMutation = useMutation({
    mutationFn: () => deleteFeedPost(post.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
  })

  const onUnshare = () => {
    if (window.confirm('Unshare this post? It is removed from your feed and retracted from followers.')) {
      deleteMutation.mutate()
    }
  }

  return (
    <>
      <FeedPostCard
        post={post}
        author={author}
        footer={
          <>
            <PostReactionSummary post={post} />
            <PostReplySummary post={post} />
            {post.autoshare_rule_id && (
              <span class="feed-post-via-rule" title="Published automatically by an auto-share rule">
                auto-shared
              </span>
            )}
            {(activityId || isArticle) && (
              <button type="button" class="btn-secondary" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
            {isArticle && (
              <button type="button" class="btn-secondary" onClick={() => setExporting(true)}>
                Export markdown
              </button>
            )}
            <button type="button" class="btn-danger" onClick={onUnshare} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? 'Unsharing…' : 'Unshare'}
            </button>
          </>
        }
      />

      {editing && isArticle && (
        <ArticleEditorDialog post={post} author={author} onClose={() => setEditing(false)} />
      )}

      {exporting && isArticle && <ArticleExportDialog postId={post.id} onClose={() => setExporting(false)} />}

      {editing && !isArticle && activityId && (
        <ShareActivityDialog
          activityId={activityId}
          activityTitle={post.activity_title}
          activityStart={post.activity_start_time ? new Date(post.activity_start_time) : undefined}
          activityEnd={post.activity_end_time ? new Date(post.activity_end_time) : undefined}
          post={post}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  )
}

function OwnPosts({ author }: { author: PostAuthor }) {
  // Keyset-paginated like the home timeline (#1012): each page carries the full
  // structured payloads, so the first load stays light however many posts exist.
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery<
    FeedPostsResponse,
    Error,
    InfiniteData<FeedPostsResponse>,
    readonly string[],
    string | undefined
  >({
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    initialPageParam: undefined,
    queryFn: ({ pageParam }) => fetchFeed(pageParam),
    queryKey: ['feed', 'posts'],
  })
  const posts = data?.pages.flatMap((page) => page.posts)

  return (
    <section>
      {isLoading && <p>Loading…</p>}
      {error && <p class="feed-error">Couldn't load your feed. Please try again.</p>}
      {posts && posts.length === 0 && (
        <p class="feed-empty">
          You haven't shared anything yet. Write an article above, or open an activity or an exercise and
          choose <strong>Share to feed</strong>.
        </p>
      )}
      {posts?.map((post) => (
        <OwnPostCard key={post.id} post={post} author={author} />
      ))}
      {hasNextPage && (
        <button
          type="button"
          class="btn-secondary timeline-more"
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  )
}

const TABS: { id: FeedTab; label: string }[] = [
  { id: 'following', label: 'Following' },
  { id: 'mine', label: 'Your posts' },
  { id: 'manage', label: 'People & sharing' },
]

const FeedTabPanel = ({ author, tab }: { author: PostAuthor; tab: FeedTab }) => {
  if (tab === 'mine') return <OwnPosts author={author} />
  if (tab === 'manage') {
    return (
      <div class="feed-manage">
        <FollowingPanel />
        <FollowedTagsPanel />
        <FollowersPanel />
        <AutoShareRulesPanel />
      </div>
    )
  }
  return <HomeTimeline />
}

/** Write first, then tabs: what the people you follow posted, your own posts, and who you follow and auto-share. */
export function Feed() {
  const { path, query, route } = useLocation()
  const tab = feedTabFromQuery(query)
  const [composer, setComposer] = useState<{ draft?: ArticleDraft } | null>(null)

  const username = auth.value.user ?? ''
  // The actor handle host is the web host the user is browsing (`<user>@<host>`);
  // the actor lives at `<host>/users/<user>` and WebFinger resolves that host.
  const host = window.location.host
  const author: PostAuthor = {
    avatarUrl: avatarUrl(username),
    displayName: username,
    handle: `@${username}@${host}`,
    profileUrl: `/u/${encodeURIComponent(username)}`,
    username,
  }

  return (
    <div class="feed-page">
      <h1>Feed</h1>
      <p class="feed-intro">
        Your federated feed. Anyone on Mastodon and the wider fediverse can follow{' '}
        <code>{author.handle}</code>.
      </p>

      <section class="feed-composer">
        <button type="button" class="btn-primary feed-composer-write" onClick={() => setComposer({})}>
          Write an article
        </button>
        <ArticleDrafts onContinue={(draft) => setComposer({ draft })} />
      </section>
      {composer && (
        <ArticleEditorDialog
          key={composer.draft?.id ?? 'new'}
          draft={composer.draft}
          author={author}
          onClose={() => setComposer(null)}
        />
      )}

      <div class="feed-tabs" role="tablist" aria-label="Feed">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            class={id === tab ? 'feed-tab feed-tab--active' : 'feed-tab'}
            aria-selected={id === tab}
            onClick={() => route(feedTabUrl(path, query, id), true)}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        <FeedTabPanel author={author} tab={tab} />
      </div>
    </div>
  )
}
