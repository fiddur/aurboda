import type { SignupProfile } from '@aurboda/api-spec'

/** The optional profile fields a signup sends: trimmed, and left out when empty. */
export const signupProfileFields = ({
  displayName,
  email,
}: {
  displayName: string
  email: string
}): SignupProfile => {
  const display_name = displayName.trim()
  const trimmedEmail = email.trim()
  return {
    ...(display_name && { display_name }),
    ...(trimmedEmail && { email: trimmedEmail }),
  }
}

/**
 * An API error as text. Most routes answer `{ error: 'message' }`, but body validation answers the
 * field errors, `{ error: { email: ['Not a valid email address'] } }`.
 */
export const apiErrorText = (error: unknown, fallback: string): string => {
  if (typeof error === 'string' && error) return error
  if (typeof error === 'object' && error !== null) {
    const messages = Object.values(error)
      .flat()
      .filter((message): message is string => typeof message === 'string' && message !== '')
    if (messages.length > 0) return messages.join('; ')
  }
  return fallback
}

/** A profile's heading: the display name over `@username` when there is one, else just `@username`. */
export const profileHeading = (
  username: string,
  displayName: string | null | undefined,
): { title: string; handle: string | null } => {
  const name = displayName?.trim()
  return name ? { handle: `@${username}`, title: name } : { handle: null, title: `@${username}` }
}
