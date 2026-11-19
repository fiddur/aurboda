import { describe, expect, it, vi } from 'vitest'

import { observeWidth } from './useMeasuredWidth'

const fakeObserver = () => {
  const state = {
    callback: undefined as ResizeObserverCallback | undefined,
    disconnect: vi.fn(),
    observe: vi.fn(),
  }
  function FakeObserver(callback: ResizeObserverCallback) {
    state.callback = callback
    return { disconnect: state.disconnect, observe: state.observe }
  }
  const fire = () => state.callback?.([], {} as ResizeObserver)
  return { Observer: FakeObserver as unknown as Parameters<typeof observeWidth>[2], fire, state }
}

describe('observeWidth', () => {
  it('reports the width at once and again on every resize until cleaned up', () => {
    const { Observer, fire, state } = fakeObserver()
    const element = { clientWidth: 300 } as Element
    const onWidth = vi.fn()

    const cleanup = observeWidth(element, onWidth, Observer)
    expect(onWidth).toHaveBeenLastCalledWith(300)
    expect(state.observe).toHaveBeenCalledWith(element)

    ;(element as { clientWidth: number }).clientWidth = 180
    fire()
    expect(onWidth).toHaveBeenLastCalledWith(180)

    cleanup()
    expect(state.disconnect).toHaveBeenCalled()
  })

  it('reports once without ResizeObserver', () => {
    const onWidth = vi.fn()
    const cleanup = observeWidth({ clientWidth: 240 } as Element, onWidth, null)
    expect(onWidth).toHaveBeenCalledTimes(1)
    expect(onWidth).toHaveBeenCalledWith(240)
    cleanup()
  })
})
