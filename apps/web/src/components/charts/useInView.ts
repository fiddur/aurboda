import { useEffect, useState } from 'preact/hooks'

type ObserverConstructor = new (
  callback: IntersectionObserverCallback,
  options?: IntersectionObserverInit,
) => Pick<IntersectionObserver, 'observe' | 'disconnect'>

/**
 * Call `onVisible` once, the first time `element` comes within the observed area,
 * and stop watching. Without IntersectionObserver (old browsers, test DOMs) it
 * counts as visible at once. Returns the cleanup.
 */
export const observeFirstVisible = (
  element: Element,
  onVisible: () => void,
  options: IntersectionObserverInit = {},
  Observer: ObserverConstructor | null = globalThis.IntersectionObserver ?? null,
): (() => void) => {
  if (Observer === null) {
    onVisible()
    return () => {}
  }
  const observer = new Observer((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      observer.disconnect()
      onVisible()
    }
  }, options)
  observer.observe(element)
  return () => observer.disconnect()
}

/**
 * True from the first time the element is (nearly) on screen; it never turns false
 * again. Attach `ref` (stable) to the element; a callback ref rather than a ref
 * object, so an element that mounts after the first render is still observed.
 */
export const useInView = (
  options: IntersectionObserverInit = {},
): { inView: boolean; ref: (element: Element | null) => void } => {
  const [element, setElement] = useState<Element | null>(null)
  const [inView, setInView] = useState(false)
  const { root, rootMargin, threshold } = options
  useEffect(() => {
    if (inView || !element) return
    return observeFirstVisible(element, () => setInView(true), { root, rootMargin, threshold })
  }, [element, inView, root, rootMargin, threshold])
  return { inView, ref: setElement }
}
