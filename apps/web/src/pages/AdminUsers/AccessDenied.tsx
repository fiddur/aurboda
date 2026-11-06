import { useLocation } from 'preact-iso'

import { auth } from '../../state/auth'

export function AdminAccessDenied({ title }: { title: string }) {
  const { route } = useLocation()
  if (auth.value.token && auth.value.is_admin === false) {
    route('/')
    return null
  }
  return (
    <div class="admin-users-page">
      <h1>{title}</h1>
      <p>You do not have permission to access this page.</p>
    </div>
  )
}
