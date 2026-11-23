export const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

export const ATTACHMENT_SCHEME = 'attachment:'

const ATTACHMENT_HREF = new RegExp(`^${ATTACHMENT_SCHEME}(${UUID_PATTERN})$`, 'i')

/** The attachment id an `attachment:<uuid>` image URL names, lower-cased; undefined for any other URL. */
export const attachmentIdOf = (href: string): string | undefined =>
  ATTACHMENT_HREF.exec(href.trim())?.[1]?.toLowerCase()
