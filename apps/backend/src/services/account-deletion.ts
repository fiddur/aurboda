import type { CentralDb } from './central-db.ts'

export type AccountDeletionError = 'confirmation_mismatch' | 'drop_failed' | 'last_admin' | 'not_found'

export type AccountDeletionResult = { ok: true } | { ok: false; error: AccountDeletionError; message: string }

export interface IntegrationDisconnector {
  name: string
  disconnect: (username: string) => Promise<void>
}

export interface AccountDeletionDeps {
  centralDb: Pick<
    CentralDb,
    | 'deleteAllCentralUserData'
    | 'deleteOuraUserMappingsByUsername'
    | 'deleteStravaAthleteMappingByUsername'
    | 'getAdmins'
    | 'getServerSetting'
    | 'isUsernameDeleted'
    | 'reserveDeletedUsername'
    | 'setServerSetting'
  >
  /** Every user with a per-user database. */
  listUsers: () => Promise<string[]>
  /** Drops the user's database and role; throws when either drop fails. */
  dropUserDb: (username: string) => Promise<void>
  /** Tells the user's followers on other servers that the actor is gone. Needs the user's database. */
  announceDeletion: (username: string) => Promise<void>
  /** Upstream grants to revoke while the tokens are still readable from the user's database. */
  integrations: IntegrationDisconnector[]
  /** Called once the user is about to lose their database, so their tokens stop working. */
  onDeleted: (username: string) => void
  log?: Pick<Console, 'error' | 'info' | 'warn'>
}

export interface DeleteAccountOptions {
  /** Who asked: the user themselves, or the admin deleting them. */
  actor: string
  /** The username typed again to confirm. */
  confirmUsername: string
}

const MESSAGES: Record<AccountDeletionError, string> = {
  confirmation_mismatch: 'The confirmation does not match the username',
  drop_failed: 'The account database could not be deleted; try again',
  last_admin: 'The last admin cannot be deleted; make another user admin first',
  not_found: 'User not found',
}

const fail = (error: AccountDeletionError): AccountDeletionResult => ({
  error,
  message: MESSAGES[error],
  ok: false,
})

/** HTTP status for a refused deletion, shared by the REST routes. */
export const accountDeletionStatus: Record<AccountDeletionError, number> = {
  confirmation_mismatch: 400,
  drop_failed: 500,
  last_admin: 409,
  not_found: 404,
}

export type AccountDeleter = (
  username: string,
  options: DeleteAccountOptions,
) => Promise<AccountDeletionResult>

/**
 * Everything before the drop is best effort: a federation or integration failure
 * is logged and the deletion goes on, while a failed drop is returned so it can be
 * retried. The name is reserved only after the steps that need the database, since
 * the role and database already keep signup from taking it until the drop.
 *
 * A user with no database whose name is reserved was dropped by an attempt that
 * failed afterwards: running the deletion again finishes it rather than answering
 * `not_found`.
 */
export const createAccountDeleter = (deps: AccountDeletionDeps): AccountDeleter => {
  const log = deps.log ?? console

  const bestEffort = async (step: string, username: string, fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (error) {
      log.warn(`⚠️ Account deletion of ${username}: ${step} failed, continuing:`, error)
    }
  }

  const drop = async (username: string): Promise<boolean> => {
    try {
      await deps.dropUserDb(username)
      return true
    } catch (error) {
      log.error(`⚠️ Account deletion of ${username}: dropping the database failed:`, error)
      return false
    }
  }

  /** An admin row whose name is reserved and has no database is left over from an unfinished deletion. */
  const isLastAdmin = async (username: string, users: string[]): Promise<boolean> => {
    const admins = await deps.centralDb.getAdmins()
    if (!admins.includes(username)) return false
    let live = 0
    for (const admin of admins) {
      if (users.includes(admin) || !(await deps.centralDb.isUsernameDeleted(admin))) live += 1
    }
    return live <= 1
  }

  const removeCentralData = async (username: string) => {
    const { centralDb } = deps
    await bestEffort('central data removal', username, () => centralDb.deleteAllCentralUserData(username))
    await bestEffort('blog setting removal', username, async () => {
      if ((await centralDb.getServerSetting('blog_username')) === username) {
        await centralDb.setServerSetting('blog_username', '')
      }
    })
  }

  const deletedBy = (username: string, actor: string) => (actor === username ? 'self' : `admin ${actor}`)

  const finishPartialDeletion = async (username: string, actor: string): Promise<AccountDeletionResult> => {
    deps.onDeleted(username)
    if (!(await drop(username))) return fail('drop_failed')
    await removeCentralData(username)
    log.info(`🗑️ Account ${username}: unfinished deletion completed by ${deletedBy(username, actor)}`)
    return { ok: true }
  }

  return async (username, { actor, confirmUsername }) => {
    if (confirmUsername !== username) return fail('confirmation_mismatch')
    const { centralDb } = deps

    const users = await deps.listUsers()
    if (!users.includes(username)) {
      if (!(await centralDb.isUsernameDeleted(username))) return fail('not_found')
      return finishPartialDeletion(username, actor)
    }

    if (await isLastAdmin(username, users)) return fail('last_admin')

    await bestEffort('federation Delete', username, () => deps.announceDeletion(username))
    for (const integration of deps.integrations) {
      await bestEffort(`${integration.name} disconnect`, username, () => integration.disconnect(username))
    }
    await bestEffort('Oura mapping removal', username, () =>
      centralDb.deleteOuraUserMappingsByUsername(username),
    )
    await bestEffort('Strava mapping removal', username, () =>
      centralDb.deleteStravaAthleteMappingByUsername(username),
    )

    await centralDb.reserveDeletedUsername(username, actor)
    deps.onDeleted(username)

    if (!(await drop(username))) return fail('drop_failed')

    await removeCentralData(username)

    log.info(`🗑️ Account ${username} deleted by ${deletedBy(username, actor)}`)
    return { ok: true }
  }
}
