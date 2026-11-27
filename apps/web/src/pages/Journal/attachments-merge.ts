/**
 * The attachments after a save answered: the server's, plus those added here since that save was
 * sent, which its answer cannot know of yet. Anything else missing from the answer was removed.
 */
export const mergeAttachments = <T extends { id: string }>(
  server: readonly T[],
  local: readonly T[],
  addedSince: ReadonlySet<string>,
): T[] => {
  const known = new Set(server.map((attachment) => attachment.id))
  return [
    ...server,
    ...local.filter((attachment) => addedSince.has(attachment.id) && !known.has(attachment.id)),
  ]
}
