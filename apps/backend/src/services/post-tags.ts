/**
 * Which hashtags a feed post carries, shared by the REST routes, the MCP tools
 * and auto-share. A post's tags are its automatic ones (the owner's default
 * tags plus a kind tag such as `#running`) — or the explicit list a share body
 * gives instead — plus every `#tag` typed in its own text. Replies get only
 * typed tags: tagging every comment on someone else's post would be spam.
 */
import { defaultFeedTags, extractHashtags, normalizeTags, toTag } from '@aurboda/api-spec'

import { getFeedPostById } from '../db/index.ts'
import { getSettings } from './settings.ts'

export interface FeedTagSettings {
  feed_default_tags?: string[]
  feed_type_tag?: boolean
}

export type PostTexts = readonly (string | null | undefined)[]

export const CHALLENGE_KIND_TAG = 'challenge'

/** The automatic tags: `defaults` (an auto-share rule's) or the owner's default tags, plus the kind tag unless turned off. */
export const autoPostTags = (
  settings: FeedTagSettings | null | undefined,
  kindTag: string | null,
  defaults?: readonly string[] | null,
): string[] => [
  ...(defaults ?? settings?.feed_default_tags ?? defaultFeedTags),
  ...(kindTag != null && settings?.feed_type_tag !== false ? [kindTag] : []),
]

const typedTags = (texts: PostTexts): string[] => texts.flatMap((text) => (text ? extractHashtags(text) : []))

/** A new post's tags: the explicit list when given, else the automatic ones, plus the typed ones. */
export const computePostTags = ({
  auto,
  explicit,
  texts,
}: {
  auto: readonly string[]
  explicit?: readonly string[]
  texts: PostTexts
}): string[] => normalizeTags([...(explicit ?? auto), ...typedTags(texts)])

/**
 * An edited post's tags. An explicit list replaces them (plus the typed ones).
 * Otherwise the stored tags stay, with the tags typed in the old text swapped
 * for those typed in the new one (`after` undefined: the text did not change) —
 * so an explicit choice made at share time survives an edit of the message.
 */
export const retagPost = ({
  after,
  before,
  explicit,
  stored,
}: {
  stored: readonly string[]
  explicit?: readonly string[]
  before: PostTexts
  after?: PostTexts
}): string[] => {
  if (explicit) return normalizeTags([...explicit, ...typedTags(after ?? before)])
  if (after === undefined) return [...stored]
  const oldTyped = new Set(typedTags(before))
  return normalizeTags([...stored.filter((tag) => !oldTyped.has(tag)), ...typedTags(after)])
}

/** An activity share's kind tag: its type, or for a custom type its key (`strength_training` → `strengthtraining`). */
export const activityKindTag = (activityType: string): string | null => toTag(activityType)

/** An exercise share's kind tag: its name, else its value (`Dumbbell Bench Press` → `dumbbellbenchpress`). */
export const exerciseKindTag = (exercise: { name?: string; value: string }): string | null =>
  (exercise.name ? toTag(exercise.name) : null) ?? toTag(exercise.value)

/** The text of an article a reader sees: its title and prose blocks. */
export const articleTexts = (article: { title: string; blocks: readonly object[] }): string[] => [
  article.title,
  ...article.blocks.flatMap((block) =>
    'type' in block && block.type === 'prose' && 'markdown' in block && typeof block.markdown === 'string'
      ? [block.markdown]
      : [],
  ),
]

/**
 * A new post's tags with the owner's settings loaded: the explicit list skips
 * them, a reply (`kind: 'reply'`) has no automatic tags at all.
 */
export const resolvePostTags = async (
  user: string,
  {
    explicit,
    kindTag = null,
    reply = false,
    texts,
  }: { explicit?: readonly string[]; kindTag?: string | null; reply?: boolean; texts: PostTexts },
  loadSettings: (user: string) => Promise<FeedTagSettings> = getSettings,
): Promise<string[]> => {
  if (reply) return computePostTags({ auto: [], texts })
  if (explicit) return computePostTags({ auto: [], explicit, texts })
  const settings = await loadSettings(user).catch(() => null)
  return computePostTags({ auto: autoPostTags(settings, kindTag), texts })
}

/**
 * The tags after a generic post edit (`PATCH /feed/:id`), or undefined when the
 * edit touches neither the tags nor the message. `edit.message` is the
 * normalised message: null clears it, undefined leaves it.
 */
export const editedPostTags = (
  existing: { tags: readonly string[]; message: string | null },
  edit: { tags?: readonly string[]; message?: string | null },
): string[] | undefined =>
  edit.tags === undefined && edit.message === undefined
    ? undefined
    : retagPost({
        after: edit.message === undefined ? undefined : [edit.message],
        before: [existing.message],
        explicit: edit.tags,
        stored: existing.tags,
      })

export type EditTagsResult = { found: false } | { found: true; tags: string[] | undefined }

/** `editedPostTags` for post `id`, loading the post only when the edit retags it. */
export const loadEditedPostTags = async (
  user: string,
  id: string,
  edit: { tags?: readonly string[]; message?: string | null },
  getPost: (
    user: string,
    id: string,
  ) => Promise<{ tags: string[]; message: string | null } | null> = getFeedPostById,
): Promise<EditTagsResult> => {
  if (edit.tags === undefined && edit.message === undefined) return { found: true, tags: undefined }
  const existing = await getPost(user, id)
  return existing ? { found: true, tags: editedPostTags(existing, edit) } : { found: false }
}
