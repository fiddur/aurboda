const normalized = (value: string): string => value.trim().toLowerCase()

/** The values an item can be merged into: all but the current one, in their given order. */
export const mergeTargets = (values: string[], current: string): string[] => {
  const key = normalized(current)
  return values.filter((v) => normalized(v) !== key)
}

/** A merge needs a target, and one spelled differently from the current value. */
export const canMergeInto = (target: string, current: string): boolean => {
  const trimmed = target.trim()
  return trimmed !== '' && trimmed !== current
}
