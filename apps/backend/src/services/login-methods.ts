export interface LoginMethodDeps {
  getPasswordLogin: (username: string) => Promise<boolean>
  countPasskeys: (username: string) => Promise<number>
  countOidcLinks: (username: string) => Promise<number>
}

export type LoginMethodCounter = (username: string) => Promise<number>

/** The ways a user can log in: the password (unless nobody knows it), each passkey and each provider link. */
export const createLoginMethodCounter =
  (deps: LoginMethodDeps): LoginMethodCounter =>
  async (username) => {
    const [password, passkeys, links] = await Promise.all([
      deps.getPasswordLogin(username),
      deps.countPasskeys(username),
      deps.countOidcLinks(username),
    ])
    return (password ? 1 : 0) + passkeys + links
  }

export const LAST_LOGIN_METHOD_ERROR =
  'This is your last way to log in: add a passkey or link another provider before removing it'
