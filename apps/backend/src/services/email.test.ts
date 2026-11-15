import nodemailer from 'nodemailer'
import { describe, expect, test, vi } from 'vitest'

import type { UserAccount } from './central-user-accounts.ts'

import { testEmail } from './email-templates.ts'
import { createMailer, type MailTransportFactory, readSmtpSettings, type SmtpSettings } from './email.ts'

const CONFIGURED = {
  smtp_from: 'Aurboda <no-reply@example.org>',
  smtp_host: 'smtp.example.org',
  smtp_password: 'pw',
  smtp_user: 'mailer',
}

const account = (email: string | null, verified: boolean): UserAccount => ({
  created_at: null,
  email,
  email_verified_at: verified ? new Date('2026-11-01T00:00:00Z') : null,
  inserted_at: new Date('2026-11-01T00:00:00Z'),
  paid_until: null,
  plan: null,
  plan_note: null,
  pre_existing: false,
  trial_ends_at: null,
  username: 'alice',
})

const jsonTransport = () => {
  const sent: {
    from: { address: string; name: string }
    to: { address: string }[]
    subject: string
    text: string
  }[] = []
  const settingsSeen: SmtpSettings[] = []
  const factory: MailTransportFactory = (settings) => {
    settingsSeen.push(settings)
    const transport = nodemailer.createTransport({ jsonTransport: true })
    return {
      sendMail: async (mail) => {
        const info = await transport.sendMail(mail)
        sent.push(JSON.parse(info.message as string))
        return info
      },
    }
  }
  return { factory, sent, settingsSeen }
}

const setup = ({
  settings = CONFIGURED as Record<string, unknown>,
  user = account('alice@example.com', true) as UserAccount | null,
  factory = jsonTransport().factory,
} = {}) => {
  const log = { info: vi.fn(), warn: vi.fn() }
  const mailer = createMailer({
    centralDb: {
      getServerSetting: vi.fn(async (key: string) => settings[key] ?? null) as never,
      getUserAccount: vi.fn(async () => user),
    },
    createTransport: factory,
    log,
  })
  return { log, mailer }
}

describe('readSmtpSettings', () => {
  test('defaults to port 587 with STARTTLS', async () => {
    const settings = await readSmtpSettings({ getServerSetting: (async () => null) as never })
    expect(settings).toEqual({ from: '', host: '', password: '', port: 587, security: 'starttls', user: '' })
  })
})

describe('createMailer', () => {
  test('sends with the configured From and logs only the kind', async () => {
    const transport = jsonTransport()
    const { log, mailer } = setup({ factory: transport.factory })
    expect(await mailer.send('bob@example.com', testEmail(), 'test')).toEqual({ ok: true })
    expect(transport.sent[0].to[0].address).toBe('bob@example.com')
    expect(transport.sent[0].from).toEqual({ address: 'no-reply@example.org', name: 'Aurboda' })
    expect(transport.sent[0].subject).toBe('Aurboda test mail')
    expect(transport.settingsSeen[0]).toMatchObject({ host: 'smtp.example.org', user: 'mailer' })
    expect(log.info).toHaveBeenCalledWith('📧 Sent test mail')
    expect(JSON.stringify(log.info.mock.calls)).not.toContain('bob@example.com')
  })

  test('sends nothing while the host or the From is unset', async () => {
    const transport = jsonTransport()
    const { mailer } = setup({ factory: transport.factory, settings: { smtp_host: 'smtp.example.org' } })
    expect(await mailer.isConfigured()).toBe(false)
    expect(await mailer.send('bob@example.com', testEmail(), 'test')).toEqual({
      ok: false,
      reason: 'not_configured',
    })
    expect(transport.sent).toEqual([])
  })

  test('a transport error is returned for the admin and logged by its class only', async () => {
    const error = Object.assign(new Error('Invalid login: 535 nope for alice@example.com'), { code: 'EAUTH' })
    const { log, mailer } = setup({
      factory: () => ({
        sendMail: async () => {
          throw error
        },
      }),
    })
    expect(await mailer.send('alice@example.com', testEmail(), 'test')).toEqual({
      error: 'Invalid login: 535 nope for alice@example.com',
      ok: false,
      reason: 'failed',
    })
    expect(log.warn).toHaveBeenCalledWith('⚠️ Sending test mail failed: EAUTH')
  })
})

describe('sendAccountEmail', () => {
  test('sends to the verified address', async () => {
    const transport = jsonTransport()
    const { mailer } = setup({ factory: transport.factory })
    expect(await mailer.sendAccountEmail('alice', testEmail())).toBe('sent')
    expect(transport.sent[0].to[0].address).toBe('alice@example.com')
  })

  test.each([
    ['no address', account(null, false)],
    ['an unverified address', account('alice@example.com', false)],
    ['no account', null],
  ])('refuses %s', async (_, user) => {
    const transport = jsonTransport()
    const { mailer } = setup({ factory: transport.factory, user })
    expect(await mailer.sendAccountEmail('alice', testEmail())).toBe('no_verified_email')
    expect(transport.sent).toEqual([])
  })

  test('is not_configured without SMTP settings, and failed when the server refuses', async () => {
    expect(await setup({ settings: {} }).mailer.sendAccountEmail('alice', testEmail())).toBe('not_configured')
    const refusing = setup({
      factory: () => ({
        sendMail: async () => {
          throw new Error('refused')
        },
      }),
    })
    expect(await refusing.mailer.sendAccountEmail('alice', testEmail())).toBe('failed')
  })
})
