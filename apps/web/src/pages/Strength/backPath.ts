export const safeBackPath = (back: string | undefined): string | undefined =>
  back !== undefined && /^\/(?![/\\])[^\\\s]*$/.test(back) ? back : undefined
