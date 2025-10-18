import { useLocation } from 'preact-iso'
import { Auth } from './Auth'

export function Header() {
  const { url } = useLocation()

  return (
    <header>
      <Auth />
      <nav>
        <a href="/" class={url == '/' && 'active'}>
          Home
        </a>
        <a href="/404" class={url == '/404' && 'active'}>
          404
        </a>
      </nav>
    </header>
  )
}
