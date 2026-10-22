export const positiveOrUndefined = (value: string): number | undefined => {
  const n = Number(value)
  return value.trim() !== '' && Number.isFinite(n) && n > 0 ? n : undefined
}
