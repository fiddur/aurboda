export interface LeaveGuard {
  message: string
  allow: (path: string) => boolean
  unsaved?: () => boolean
}

declare global {
  interface Window {
    /** Set while a page asks before it is left; the Android app calls it before its own navigation. */
    aurbodaLeaveGuard?: () => string
  }
}

export interface LeaveLink {
  /** The resolved, absolute address. */
  href: string
  /** The attribute as written, to tell an in-page `#` link apart. */
  rawHref: string | null
  target: string
  download: boolean
}

export interface LeaveClick {
  button: number
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  defaultPrevented: boolean
  link?: LeaveLink
}

export const needsLeaveConfirm = (
  click: LeaveClick,
  guard: LeaveGuard | undefined,
  origin: string,
): boolean => {
  const { link } = click
  if (!guard || !link || click.defaultPrevented || click.button !== 0) return false
  if (click.altKey || click.ctrlKey || click.metaKey || click.shiftKey) return false
  const inPage = link.rawHref === null || link.rawHref.startsWith('#')
  if (link.target !== '' || link.download || inPage) return false
  let url: URL
  try {
    url = new URL(link.href)
  } catch {
    return false
  }
  return url.origin === origin && !guard.allow(url.pathname)
}

let current: LeaveGuard | undefined
let installed = false

const linkOf = (event: MouseEvent): LeaveLink | undefined => {
  const anchor = event
    .composedPath()
    .find((el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement && el.hasAttribute('href'))
  return anchor
    ? {
        download: anchor.hasAttribute('download'),
        href: anchor.href,
        rawHref: anchor.getAttribute('href'),
        target: anchor.target,
      }
    : undefined
}

const pickKeys = (event: MouseEvent): Omit<LeaveClick, 'link'> => ({
  altKey: event.altKey,
  button: event.button,
  ctrlKey: event.ctrlKey,
  defaultPrevented: event.defaultPrevented,
  metaKey: event.metaKey,
  shiftKey: event.shiftKey,
})

/**
 * Registered on `window` in the capture phase, so it runs before preact-iso's bubble-phase click handler on
 * `window`, which routes without looking at `defaultPrevented`: stopping propagation is what keeps it from
 * routing.
 */
const onClick = (event: MouseEvent) => {
  const guard = current
  const click = { ...pickKeys(event), link: linkOf(event) }
  if (!guard || !needsLeaveConfirm(click, guard, location.origin) || window.confirm(guard.message)) return
  event.preventDefault()
  event.stopPropagation()
}

const onBeforeUnload = (event: BeforeUnloadEvent) => {
  if (current?.unsaved?.()) event.preventDefault()
}

const install = () => {
  if (installed) return
  installed = true
  window.addEventListener('click', onClick, true)
  window.addEventListener('beforeunload', onBeforeUnload)
}

export const setLeaveGuard = (guard: LeaveGuard | undefined): void => {
  install()
  current = guard
  if (guard) window.aurbodaLeaveGuard = () => guard.message
  else delete window.aurbodaLeaveGuard
}
