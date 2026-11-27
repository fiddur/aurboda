export interface AttachmentChange {
  kind: 'added' | 'removed'
  id: string
}

/** The ids added and removed by `changes`, in order: the later change to an id wins. */
export const attachmentChangesSince = (
  changes: readonly AttachmentChange[],
): { addedSince: Set<string>; removedSince: Set<string> } => {
  const addedSince = new Set<string>()
  const removedSince = new Set<string>()
  for (const { kind, id } of changes) {
    const [into, outOf] = kind === 'added' ? [addedSince, removedSince] : [removedSince, addedSince]
    into.add(id)
    outOf.delete(id)
  }
  return { addedSince, removedSince }
}

/**
 * The attachments after a save answered: the server's, minus those removed here since that save
 * was sent, plus those added here since, which its answer cannot know of yet. Anything else missing
 * from the answer was removed.
 */
export const mergeAttachments = <T extends { id: string }>(
  server: readonly T[],
  local: readonly T[],
  addedSince: ReadonlySet<string>,
  removedSince: ReadonlySet<string> = new Set(),
): T[] => {
  const known = new Set(server.map((attachment) => attachment.id))
  return [
    ...server.filter((attachment) => !removedSince.has(attachment.id)),
    ...local.filter((attachment) => addedSince.has(attachment.id) && !known.has(attachment.id)),
  ]
}
