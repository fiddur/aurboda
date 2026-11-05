export const canNativeShare = (nav: { share?: unknown } | undefined): boolean =>
  typeof nav?.share === 'function'

export const isAbortError = (err: unknown): boolean => err instanceof Error && err.name === 'AbortError'

export const canWriteClipboard = (nav: { clipboard?: { writeText?: unknown } } | undefined): boolean =>
  typeof nav?.clipboard?.writeText === 'function'
