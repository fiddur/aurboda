import { useLocation } from 'preact-iso'
import { useState } from 'preact/hooks'

import { auth, logout } from '../state/auth'
import { DATA_SOURCE_LINKS, NAV_LINKS } from './nav-links'
import './Sidebar.css'

const COLLAPSED_KEY = 'sidebar-collapsed'

// eslint-disable-next-line complexity -- navigation component with many conditional branches
export function Sidebar() {
  const { url } = useLocation()
  const isLoggedIn = auth.value.token
  const isAdmin = auth.value.is_admin

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === '1')
  const [dsExpanded, setDsExpanded] = useState(() => url.startsWith('/data-sources'))

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
    // Notify charts/maps that layout changed
    setTimeout(() => window.dispatchEvent(new Event('resize')), 220)
  }

  const handleLogout = (e: Event) => {
    e.preventDefault()
    logout()
  }

  const isDataSourcesActive = url.startsWith('/data-sources')

  return (
    <aside class={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div class="sidebar-header">
        <span class="sidebar-brand">Aurboda</span>
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
          <>
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                class={`sidebar-link${url === link.href ? ' active' : ''}`}
                title={collapsed ? link.label : undefined}
              >
                <span class="sidebar-icon">{link.icon}</span>
                <span class="sidebar-label">{link.label}</span>
              </a>
            ))}

            {/* Data Sources expandable (collapsed: just a link) */}
            {collapsed ? (
              <a
                href="/data-sources"
                class={`sidebar-link${isDataSourcesActive ? ' active' : ''}`}
                title="Data Sources"
              >
                <span class="sidebar-icon">📡</span>
                <span class="sidebar-label">Data Sources</span>
              </a>
            ) : (
              <>
                <button
                  class={`sidebar-section-btn${isDataSourcesActive ? ' active' : ''}`}
                  onClick={() => setDsExpanded((v) => !v)}
                  type="button"
                >
                  <span class="sidebar-icon">📡</span>
                  <span class="sidebar-label">Data Sources</span>
                  <span class="sidebar-section-arrow">{dsExpanded ? '▴' : '▾'}</span>
                </button>
                {dsExpanded && (
                  <div class="sidebar-sub-links">
                    {DATA_SOURCE_LINKS.map((link) => (
                      <a
                        key={link.path}
                        href={link.path}
                        class={`sidebar-link${url === link.path ? ' active' : ''}`}
                      >
                        <span class="sidebar-label">{link.label}</span>
                      </a>
                    ))}
                  </div>
                )}
              </>
            )}

            {isAdmin && (
              <a
                href="/admin"
                class={`sidebar-link${url === '/admin' ? ' active' : ''}`}
                title={collapsed ? 'Admin' : undefined}
              >
                <span class="sidebar-icon">⚙️</span>
                <span class="sidebar-label">Admin</span>
              </a>
            )}
          </>
        ) : (
          <a
            href="/login"
            class={`sidebar-link${url === '/login' ? ' active' : ''}`}
            title={collapsed ? 'Login' : undefined}
          >
            <span class="sidebar-icon">🔑</span>
            <span class="sidebar-label">Login</span>
          </a>
        )}
      </nav>

      {isLoggedIn && (
        <div class="sidebar-footer">
          <a
            href="/settings"
            class={`sidebar-link${url === '/settings' ? ' active' : ''}`}
            title={collapsed ? 'Settings' : undefined}
          >
            <span class="sidebar-icon">⚙</span>
            <span class="sidebar-label">Settings</span>
          </a>
          <a
            href="/settings"
            class={`sidebar-link${url === '/settings' ? ' active' : ''}`}
            title={collapsed ? auth.value.user : undefined}
          >
            <span class="sidebar-icon">👤</span>
            <span class="sidebar-label">{auth.value.user}</span>
          </a>
          <a href="#" class="sidebar-link" onClick={handleLogout}>
            <span class="sidebar-icon">🚪</span>
            <span class="sidebar-label">Logout</span>
          </a>
        </div>
      )}
    </aside>
  )
}
