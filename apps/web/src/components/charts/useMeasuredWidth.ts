import { useEffect, useState } from 'preact/hooks'

type ObserverConstructor = new (
  callback: ResizeObserverCallback,
) => Pick<ResizeObserver, 'observe' | 'disconnect'>

/**
 * Report `element`'s width now and whenever it resizes. Without ResizeObserver
 * (old browsers, test DOMs) it reports once. Returns the cleanup.
 */
export const observeWidth = (
  element: Element,
  onWidth: (width: number) => void,
  Observer: ObserverConstructor | null = globalThis.ResizeObserver ?? null,
): (() => void) => {
  const measure = () => onWidth(element.clientWidth)
  measure()
  if (Observer === null) return () => {}
  const observer = new Observer(measure)
  observer.observe(element)
  return () => observer.disconnect()
}

/**
 * The element's current width. `element` stays null until the element has a width,
 * so a chart draws only once there is room. A callback ref, so an element that
 * mounts after the first render (behind a placeholder) is measured.
 */
export const useMeasuredWidth = <T extends Element>(): {
  element: T | null
  ref: (element: T | null) => void
  width: number
} => {
  const [element, setElement] = useState<T | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!element) return
    return observeWidth(element, setWidth)
  }, [element])
  return { element: width > 0 ? element : null, ref: setElement, width }
}
