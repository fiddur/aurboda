import { auth, login, logout } from '../state/auth'

export function Auth() {
  const onSubmit = async (e: Event) => {
    e.preventDefault()

    if (e.currentTarget instanceof HTMLFormElement) {
      const formData = new FormData(e.currentTarget)
      await login(formData.get('user') as string, formData.get('pass') as string)

      e.currentTarget.reset() // TypeScript now knows this is safe
    } else {
      console.error("Expected a form element as the event's target.")
    }
  }

  return auth.value.user ? (
    <div>
      <span>Welcome, {auth.value.user}!</span>
      <button onClick={logout}>Logout</button>
    </div>
  ) : (
    <form onSubmit={onSubmit}>
      <label>
        Username: <input name="user" required />
      </label>
      <label>
        Password: <input name="pass" type="password" required />
      </label>
      <button type="submit">Login</button>
    </form>
  )
}
