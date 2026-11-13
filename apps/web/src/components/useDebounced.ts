import { useEffect, useState } from 'preact/hooks'

export const useDebounced = <T>(value: T, ms: number): T => {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}
