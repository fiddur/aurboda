import { describe, expect, test } from 'vitest'

import {
  escapeHtml,
  recoveryEmail,
  recoveryLink,
  recoveryNoticeEmail,
  testEmail,
  verificationEmail,
  verifyEmailLink,
} from './email-templates.ts'

describe('links', () => {
  test('point at the web pages with the token encoded, whatever trailing slash the host has', () => {
    expect(verifyEmailLink('https://aurboda.example/', 'a+b/c')).toBe(
      'https://aurboda.example/verify-email?token=a%2Bb%2Fc',
    )
    expect(recoveryLink('https://aurboda.example', 'tok-_1')).toBe(
      'https://aurboda.example/recover?token=tok-_1',
    )
  })
})

describe('escapeHtml', () => {
  test('escapes the characters that break out of text or an attribute', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  })
})

describe('messages', () => {
  const link = 'https://aurboda.example/recover?token=abc&x="y"'

  test('verification and recovery mails carry the link in both parts and name the username', () => {
    for (const message of [
      verificationEmail({ link, username: 'alice' }),
      recoveryEmail({ link, username: 'alice' }),
    ]) {
      expect(message.text).toContain(link)
      expect(message.text).toContain('alice')
      expect(message.html).toContain('href="https://aurboda.example/recover?token=abc&amp;x=&quot;y&quot;"')
      expect(message.html).toContain('<strong>alice</strong>')
      expect(message.html).not.toContain('<img')
    }
  })

  test('the username is HTML-escaped', () => {
    const { html } = verificationEmail({ link, username: '<b>x</b>' })
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(html).not.toContain('<b>x</b>')
  })

  test('recovery notices carry no link', () => {
    const reset = recoveryNoticeEmail({ kind: 'password_reset', username: 'alice' })
    const signIn = recoveryNoticeEmail({ kind: 'recovery_sign_in', username: 'alice' })
    expect(reset.subject).toBe('Your Aurboda password was reset')
    expect(signIn.subject).toBe('Your Aurboda account was signed in to with a recovery link')
    for (const message of [reset, signIn]) {
      expect(message.text).not.toMatch(/https?:/)
      expect(message.html).not.toContain('href')
    }
  })

  test('the test mail is fixed', () => {
    expect(testEmail().subject).toBe('Aurboda test mail')
  })
})
