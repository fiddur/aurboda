import { describe, expect, it, vi } from 'vitest'

import { observeFirstVisible } from './useInView'

const fakeObserver = () => {
  const state = {
    callback: undefined as IntersectionObserverCallback | undefined,
    disconnect: vi.fn(),
    observe: vi.fn(),
    options: undefined as IntersectionObserverInit | undefined,
  }
  function FakeObserver(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    state.callback = callback
    state.options = options
    return { disconnect: state.disconnect, observe: state.observe }
  }
  const fire = (isIntersecting: boolean) =>
    state.callback?.([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver)
  return {
    Observer: FakeObserver as unknown as Parameters<typeof observeFirstVisible>[3],
    fire,
    state,
  }
}

const element = {} as Element

describe('observeFirstVisible', () => {
  it('waits for the element to intersect, then reports once and stops watching', () => {
    const { Observer, fire, state } = fakeObserver()
    const onVisible = vi.fn()
    observeFirstVisible(element, onVisible, { rootMargin: '200px' }, Observer)

    expect(state.observe).toHaveBeenCalledWith(element)
    expect(state.options).toEqual({ rootMargin: '200px' })
    fire(false)
    expect(onVisible).not.toHaveBeenCalled()

    fire(true)
    expect(onVisible).toHaveBeenCalledTimes(1)
    expect(state.disconnect).toHaveBeenCalled()
  })

  it('the cleanup disconnects an observer that never fired', () => {
    const { Observer, state } = fakeObserver()
    const cleanup = observeFirstVisible(element, vi.fn(), {}, Observer)
    cleanup()
    expect(state.disconnect).toHaveBeenCalledTimes(1)
  })

  it('without IntersectionObserver the element counts as visible at once', () => {
    const onVisible = vi.fn()
    observeFirstVisible(element, onVisible, {}, null)
    expect(onVisible).toHaveBeenCalledTimes(1)
  })
})
