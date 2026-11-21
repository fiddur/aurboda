import { useLocation } from 'preact-iso'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'

import { auth, ensureStatusLoaded, logout, signupMode } from '../state/auth'
import {
  HELP_LINK,
  isLinkActive,
  NAV_TOP_LINKS,
  type NavSection,
  type NavSectionId,
  visibleLinks,
  visibleSections,
} from './nav-links'
import { NotificationBellDropdown } from './NotificationBell'
import { useHiddenPages } from './useHiddenPages'
import { useOpenSections } from './useOpenSections'
import './Sidebar.css'

const COLLAPSED_KEY = 'sidebar-collapsed'
const FLYOUT_LEFT = 60
const FLYOUT_MARGIN = 8

interface Flyout {
  id: NavSectionId
  top: number
}

const readCollapsed = (): boolean => {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

const sectionActive = (section: NavSection, url: string): boolean =>
  section.links.some((l) => isLinkActive(l.href, url))

function SidebarLink(props: {
  href: string
  label: string
  icon?: string
  active: boolean
  collapsed: boolean
  onClick?: (e: Event) => void
}) {
  return (
    <a
      href={props.href}
      class={`sidebar-link${props.active ? ' active' : ''}`}
      title={props.collapsed ? props.label : undefined}
      onClick={props.onClick}
    >
      {props.icon && <span class="sidebar-icon">{props.icon}</span>}
      <span class="sidebar-label">{props.label}</span>
    </a>
  )
}

function ExpandedSection(props: { section: NavSection; url: string; open: boolean; onToggle: () => void }) {
  const { section, url, open } = props
  const containerId = `sidebar-section-${section.id}`
  return (
    <>
      <button
        class={`sidebar-section-btn${!open && sectionActive(section, url) ? ' active' : ''}`}
        onClick={props.onToggle}
        type="button"
        aria-expanded={open}
        aria-controls={containerId}
      >
        <span class="sidebar-icon">{section.icon}</span>
        <span class="sidebar-label">{section.label}</span>
        <span class="sidebar-section-arrow">{open ? '▴' : '▾'}</span>
      </button>
      <div class="sidebar-sub-links" id={containerId} hidden={!open}>
        {section.links.map((link) => (
          <SidebarLink
            key={link.href}
            href={link.href}
            label={link.label}
            active={isLinkActive(link.href, url)}
            collapsed={false}
          />
        ))}
      </div>
    </>
  )
}

function SectionFlyout(props: { section: NavSection; top: number; url: string; onClose: () => void }) {
  const { section, url } = props
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const maxTop = window.innerHeight - el.offsetHeight - FLYOUT_MARGIN
    el.style.top = `${Math.max(FLYOUT_MARGIN, Math.min(props.top, maxTop))}px`
  }, [props.top, section.id])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null
      if (ref.current?.contains(target) || target?.closest('[data-flyout-trigger]')) return
      props.onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [props.onClose])

  return (
    <div
      ref={ref}
      id="sidebar-flyout"
      class="sidebar-flyout"
      style={{ left: `${FLYOUT_LEFT}px`, top: `${props.top}px` }}
    >
      <div class="sidebar-flyout-title">{section.label}</div>
      {section.links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          class={`sidebar-flyout-link${isLinkActive(link.href, url) ? ' active' : ''}`}
          onClick={props.onClose}
        >
          {link.label}
        </a>
      ))}
    </div>
  )
}

function CollapsedSections(props: { sections: NavSection[]; url: string }) {
  const { sections, url } = props
  const [flyout, setFlyout] = useState<Flyout | null>(null)
  const close = useRef(() => setFlyout(null)).current

  useEffect(close, [url])

  const toggle = (id: NavSectionId) => (e: MouseEvent) => {
    const top = (e.currentTarget as HTMLElement).getBoundingClientRect().top
    setFlyout((current) => (current?.id === id ? null : { id, top }))
  }

  const shown = flyout && sections.find((s) => s.id === flyout.id)

  return (
    <>
      {sections.map((section) => (
        <button
          key={section.id}
          class={`sidebar-section-btn${sectionActive(section, url) ? ' active' : ''}`}
          onClick={toggle(section.id)}
          title={section.label}
          type="button"
          data-flyout-trigger
          aria-expanded={flyout?.id === section.id}
          aria-controls={flyout?.id === section.id ? 'sidebar-flyout' : undefined}
        >
          <span class="sidebar-icon">{section.icon}</span>
          <span class="sidebar-label">{section.label}</span>
        </button>
      ))}
      {shown && <SectionFlyout section={shown} top={flyout.top} url={url} onClose={close} />}
    </>
  )
}

function LoggedInNav(props: { url: string; collapsed: boolean }) {
  const { url, collapsed } = props
  const hidden = useHiddenPages()
  const sections = visibleSections(hidden, !!auth.value.is_admin)
  const { open, toggle } = useOpenSections(url)

  return (
    <>
      {visibleLinks(NAV_TOP_LINKS, hidden).map((link) => (
        <SidebarLink
          key={link.href}
          href={link.href}
          label={link.label}
          icon={link.icon}
          active={isLinkActive(link.href, url)}
          collapsed={collapsed}
        />
      ))}
      {collapsed ? (
        <CollapsedSections sections={sections} url={url} />
      ) : (
        sections.map((section) => (
          <ExpandedSection
            key={section.id}
            section={section}
            url={url}
            open={open.includes(section.id)}
            onToggle={() => toggle(section.id)}
          />
        ))
      )}
    </>
  )
}

function LoggedOutNav(props: { url: string; collapsed: boolean }) {
  const { url, collapsed } = props
  return (
    <>
      <SidebarLink href="/login" label="Login" icon="🔑" active={url === '/login'} collapsed={collapsed} />
      {signupMode.value === 'open' && (
        <SidebarLink
          href="/signup"
          label="Sign up"
          icon="✨"
          active={url === '/signup'}
          collapsed={collapsed}
        />
      )}
    </>
  )
}

function SidebarFooter(props: { url: string; collapsed: boolean }) {
  const { url, collapsed } = props
  const handleLogout = (e: Event) => {
    e.preventDefault()
    logout()
  }
  return (
    <div class="sidebar-footer">
      <SidebarLink
        href={HELP_LINK.href}
        label={HELP_LINK.label}
        icon={HELP_LINK.icon}
        active={isLinkActive(HELP_LINK.href, url)}
        collapsed={collapsed}
      />
      <a
        href="/settings"
        class={`sidebar-link${isLinkActive('/settings', url) ? ' active' : ''}`}
        title={collapsed ? `Settings (${auth.value.user})` : undefined}
      >
        <span class="sidebar-icon">⚙</span>
        <span class="sidebar-label">Settings</span>
        <span class="sidebar-user">{auth.value.user}</span>
      </a>
      <SidebarLink
        href="#"
        label="Log out"
        icon="🚪"
        active={false}
        collapsed={collapsed}
        onClick={handleLogout}
      />
    </div>
  )
}

export function Sidebar() {
  const { url } = useLocation()
  const isLoggedIn = auth.value.token

  useEffect(() => {
    if (!isLoggedIn) ensureStatusLoaded()
  }, [isLoggedIn])

  const [collapsed, setCollapsed] = useState(readCollapsed)

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
    } catch {
      // The choice then lasts for this page view only.
    }
    setTimeout(() => window.dispatchEvent(new Event('resize')), 220)
  }

  return (
    <aside class={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div class="sidebar-header">
        <a href="/" class="sidebar-brand">
          Aurboda
        </a>
        {isLoggedIn && <NotificationBellDropdown />}
        <button
          class="sidebar-toggle"
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          type="button"
        >
          {collapsed ? '▶' : '◀'}
        </button>
      </div>

      <nav class="sidebar-nav">
        {isLoggedIn ? (
          <LoggedInNav url={url} collapsed={collapsed} />
        ) : (
          <LoggedOutNav url={url} collapsed={collapsed} />
        )}
      </nav>

      {isLoggedIn && <SidebarFooter url={url} collapsed={collapsed} />}
    </aside>
  )
}
