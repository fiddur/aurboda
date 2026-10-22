export const syncKeys = (keys: string[], length: number, newKey: () => string): string[] =>
  keys.length === length
    ? keys
    : keys.length > length
      ? keys.slice(0, length)
      : [...keys, ...Array.from({ length: length - keys.length }, newKey)]

export const removeKey = (keys: string[], index: number): string[] => keys.filter((_, i) => i !== index)
