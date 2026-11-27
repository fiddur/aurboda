// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type LeaveClick, type LeaveGuard, needsLeaveConfirm, setLeaveGuard } from './leaveGuard'

const origin = 'https://aurboda.example'

const guard: LeaveGuard = {
  allow: (path) => path.startsWith('/strength/session/') || path === '/strength/live',
  message: 'Leave the session?',
}

const click = (href: string, extra: Partial<LeaveClick> = {}, link: Partial<LeaveClick['link']> = {}) => ({
  altKey: false,
  button: 0,
  ctrlKey: false,
  defaultPrevented: false,
  link: { download: false, href: new URL(href, origin).href, rawHref: href, target: '', ...link },
  metaKey: false,
  shiftKey: false,
  ...extra,
})

describe('needsLeaveConfirm', () => {
  it('asks for a plain click on a same-origin link to a page the guard does not allow', () => {
    expect(needsLeaveConfirm(click('/strength'), guard, origin)).toBe(true)
    expect(needsLeaveConfirm(click(`${origin}/detail/activity/a1`), guard, origin)).toBe(true)
  })

  it('lets the allowed pages through', () => {
    expect(needsLeaveConfirm(click('/strength/session/a1'), guard, origin)).toBe(false)
    expect(needsLeaveConfirm(click('/strength/live'), guard, origin)).toBe(false)
  })

  it('leaves what the browser opens elsewhere alone', () => {
    expect(needsLeaveConfirm(click('/strength', { ctrlKey: true }), guard, origin)).toBe(false)
    expect(needsLeaveConfirm(click('/strength', { metaKey: true }), guard, origin)).toBe(false)
    expect(needsLeaveConfirm(click('/strength', { shiftKey: true }), guard, origin)).toBe(false)
    expect(needsLeaveConfirm(click('/strength', { altKey: true }), guard, origin)).toBe(false)
    expect(needsLeaveConfirm(click('/strength', { button: 1 }), guard, origin)).toBe(false)
    expect(needsLeaveConfirm(click('/strength', {}, { target: '_blank' }), guard, origin)).toBe(false)
    expect(needsLeaveConfirm(click('/strength', {}, { download: true }), guard, origin)).toBe(false)
    expect(needsLeaveConfirm(click('https://other.example/x'), guard, origin)).toBe(false)
  })

  it('ignores in-page links, handled clicks, clicks off a link and no guard', () => {
    expect(needsLeaveConfirm(click('#sets'), guard, origin)).toBe(false)
    expect(needsLeaveConfirm(click('/strength', { defaultPrevented: true }), guard, origin)).toBe(false)
    expect(needsLeaveConfirm({ ...click('/strength'), link: undefined }, guard, origin)).toBe(false)
    expect(needsLeaveConfirm(click('/strength'), undefined, origin)).toBe(false)
  })
})

describe('setLeaveGuard', () => {
  afterEach(() => {
    setLeaveGuard(undefined)
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  const clickLink = (href: string) => {
    const a = document.createElement('a')
    a.href = href
    document.body.append(a)
    const routed = vi.fn((e: Event) => e.preventDefault())
    window.addEventListener('click', routed)
    const event = new MouseEvent('click', { bubbles: true, button: 0, cancelable: true })
    a.dispatchEvent(event)
    window.removeEventListener('click', routed)
    return { event, routed }
  }

  it('exposes the message to the Android app while set, and removes it when cleared', () => {
    setLeaveGuard(guard)
    expect(window.aurbodaLeaveGuard?.()).toBe('Leave the session?')
    setLeaveGuard(undefined)
    expect('aurbodaLeaveGuard' in window).toBe(false)
  })

  it('stops a cancelled link click before a bubble-phase router on window sees it', () => {
    setLeaveGuard(guard)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { event, routed } = clickLink('/strength')
    expect(confirm).toHaveBeenCalledWith('Leave the session?')
    expect(event.defaultPrevented).toBe(true)
    expect(routed).not.toHaveBeenCalled()
  })

  it('lets a confirmed click and an allowed link through', () => {
    setLeaveGuard(guard)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    expect(clickLink('/strength').routed).toHaveBeenCalled()
    confirm.mockClear()
    expect(clickLink('/strength/session/a1').routed).toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
  })
})
