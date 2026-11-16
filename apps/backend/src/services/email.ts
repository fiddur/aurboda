import { DEFAULT_SMTP_PORT, type SmtpSecurity } from '@aurboda/api-spec'
import nodemailer from 'nodemailer'

import type { CentralDb } from './central-db.ts'
import type { MailMessage } from './email-templates.ts'

export interface SmtpSettings {
  host: string
  port: number
  security: SmtpSecurity
  user: string
  password: string
  from: string
}

export type SmtpSettingsDb = Pick<CentralDb, 'getServerSetting'>

export const readSmtpSettings = async (centralDb: SmtpSettingsDb): Promise<SmtpSettings> => {
  const [host, port, security, user, password, from] = await Promise.all([
    centralDb.getServerSetting('smtp_host'),
    centralDb.getServerSetting('smtp_port'),
    centralDb.getServerSetting('smtp_security'),
    centralDb.getServerSetting('smtp_user'),
    centralDb.getServerSetting('smtp_password'),
    centralDb.getServerSetting('smtp_from'),
  ])
  return {
    from: from ?? '',
    host: host ?? '',
    password: password ?? '',
    port: port ?? DEFAULT_SMTP_PORT,
    security: security ?? 'starttls',
    user: user ?? '',
  }
}

/** Email is on when the admin has set an SMTP host and a From address. */
export const isSmtpConfigured = (settings: SmtpSettings): boolean => !!settings.host && !!settings.from

export const isEmailConfigured = async (centralDb: SmtpSettingsDb): Promise<boolean> =>
  isSmtpConfigured(await readSmtpSettings(centralDb))

export interface OutgoingMail extends MailMessage {
  from: string
  to: string
}

export interface MailTransport {
  sendMail: (mail: OutgoingMail) => Promise<unknown>
}

export type MailTransportFactory = (settings: SmtpSettings) => MailTransport

const CONNECTION_TIMEOUT_MS = 5_000
const SOCKET_TIMEOUT_MS = 10_000

export const smtpTransport: MailTransportFactory = (settings) =>
  nodemailer.createTransport({
    auth: settings.user ? { pass: settings.password, user: settings.user } : undefined,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: CONNECTION_TIMEOUT_MS,
    host: settings.host,
    ignoreTLS: settings.security === 'none',
    port: settings.port,
    requireTLS: settings.security === 'starttls',
    secure: settings.security === 'tls',
    socketTimeout: SOCKET_TIMEOUT_MS,
  })

/** What kind of mail is being sent: the only thing about a message that is logged. */
export type MailKind = 'verification' | 'recovery' | 'recovery_notice' | 'test' | 'account'

export type SendResult =
  | { ok: true }
  | { ok: false; reason: 'not_configured' }
  | { ok: false; reason: 'failed'; error: string }

export type AccountEmailResult = 'sent' | 'not_configured' | 'no_verified_email' | 'failed'

export interface Mailer {
  isConfigured: () => Promise<boolean>
  /** Sends to any address. Only verification and the admin test mail call it directly. */
  send: (to: string, message: MailMessage, kind: MailKind) => Promise<SendResult>
  /**
   * Sends to the account's email, only when email is configured and that address is verified.
   * Every later sender of account mail goes through this.
   */
  sendAccountEmail: (username: string, message: MailMessage, kind?: MailKind) => Promise<AccountEmailResult>
}

export interface MailerDeps {
  centralDb: Pick<CentralDb, 'getServerSetting' | 'getUserAccount'>
  createTransport?: MailTransportFactory
  log?: Pick<Console, 'info' | 'warn'>
}

const errorClass = (error: unknown): string => {
  const { code, name } = (error ?? {}) as { code?: unknown; name?: unknown }
  if (typeof code === 'string') return code
  return typeof name === 'string' ? name : 'Error'
}

export const createMailer = ({
  centralDb,
  createTransport = smtpTransport,
  log = console,
}: MailerDeps): Mailer => {
  const send: Mailer['send'] = async (to, message, kind) => {
    const settings = await readSmtpSettings(centralDb)
    if (!isSmtpConfigured(settings)) return { ok: false, reason: 'not_configured' }
    try {
      await createTransport(settings).sendMail({ ...message, from: settings.from, to })
      log.info(`📧 Sent ${kind} mail`)
      return { ok: true }
    } catch (error) {
      log.warn(`⚠️ Sending ${kind} mail failed: ${errorClass(error)}`)
      return {
        error: error instanceof Error ? error.message : 'The mail could not be sent',
        ok: false,
        reason: 'failed',
      }
    }
  }

  return {
    isConfigured: () => isEmailConfigured(centralDb),
    send,
    sendAccountEmail: async (username, message, kind = 'account') => {
      const settings = await readSmtpSettings(centralDb)
      if (!isSmtpConfigured(settings)) return 'not_configured'
      const account = await centralDb.getUserAccount(username)
      if (!account?.email || !account.email_verified_at) return 'no_verified_email'
      const result = await send(account.email, message, kind)
      return result.ok ? 'sent' : result.reason === 'failed' ? 'failed' : 'not_configured'
    },
  }
}
