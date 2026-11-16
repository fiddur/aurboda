export interface MailMessage {
  subject: string
  text: string
  html: string
}

const HTML_ESCAPES: Record<string, string> = {
  '"': '&quot;',
  '&': '&amp;',
  "'": '&#39;',
  '<': '&lt;',
  '>': '&gt;',
}

export const escapeHtml = (value: string): string => value.replaceAll(/[&<>"']/g, (c) => HTML_ESCAPES[c])

const withToken = (webHost: string, path: string, token: string): string =>
  `${webHost.replace(/\/+$/, '')}${path}?token=${encodeURIComponent(token)}`

export const verifyEmailLink = (webHost: string, token: string): string =>
  withToken(webHost, '/verify-email', token)

export const recoveryLink = (webHost: string, token: string): string => withToken(webHost, '/recover', token)

const paragraphs = (lines: string[]): string => lines.map((line) => `<p>${line}</p>`).join('\n')

const page = (body: string): string =>
  `<!doctype html>\n<html><body style="font-family: sans-serif; line-height: 1.5">\n${body}\n</body></html>`

const linkParagraph = (link: string, label: string): string =>
  `<p><a href="${escapeHtml(link)}">${escapeHtml(label)}</a></p>`

export const verificationEmail = ({ username, link }: { username: string; link: string }): MailMessage => ({
  html: page(
    [
      paragraphs([
        `Someone, probably you, set this address as the email of the Aurboda account <strong>${escapeHtml(username)}</strong>.`,
        'Confirm it with this link (valid for 24 hours):',
      ]),
      linkParagraph(link, 'Confirm the address'),
      paragraphs([
        'Only a confirmed address is used, for password reset and account recovery. If you did not ask for this, ignore this mail.',
      ]),
    ].join('\n'),
  ),
  subject: 'Confirm your Aurboda email address',
  text: [
    `Someone, probably you, set this address as the email of the Aurboda account "${username}".`,
    '',
    'Confirm it with this link (valid for 24 hours):',
    link,
    '',
    'Only a confirmed address is used, for password reset and account recovery. If you did not ask for this, ignore this mail.',
  ].join('\n'),
})

export const recoveryEmail = ({ username, link }: { username: string; link: string }): MailMessage => ({
  html: page(
    [
      paragraphs([
        `Someone, probably you, asked to recover the Aurboda account <strong>${escapeHtml(username)}</strong>.`,
        'With this link you can set a new password, or sign in and add a new passkey. It works once, within 30 minutes:',
      ]),
      linkParagraph(link, 'Recover the account'),
      paragraphs(['If you did not ask for this, ignore this mail: nothing changes.']),
    ].join('\n'),
  ),
  subject: 'Recover your Aurboda account',
  text: [
    `Someone, probably you, asked to recover the Aurboda account "${username}".`,
    '',
    'With this link you can set a new password, or sign in and add a new passkey. It works once, within 30 minutes:',
    link,
    '',
    'If you did not ask for this, ignore this mail: nothing changes.',
  ].join('\n'),
})

export type RecoveryNoticeKind = 'password_reset' | 'recovery_sign_in'

const NOTICE_SUBJECTS: Record<RecoveryNoticeKind, string> = {
  password_reset: 'Your Aurboda password was reset',
  recovery_sign_in: 'Your Aurboda account was signed in to with a recovery link',
}

const noticeSentence = (kind: RecoveryNoticeKind, username: string): string =>
  kind === 'password_reset'
    ? `The password of the Aurboda account ${username} was just reset with a recovery link sent to this address.`
    : `The Aurboda account ${username} was just signed in to with a recovery link sent to this address.`

export const recoveryNoticeEmail = ({
  username,
  kind,
}: {
  username: string
  kind: RecoveryNoticeKind
}): MailMessage => {
  const closing = 'If that was not you, recover the account again and tell the server admin.'
  return {
    html: page(paragraphs([escapeHtml(noticeSentence(kind, username)), closing])),
    subject: NOTICE_SUBJECTS[kind],
    text: [noticeSentence(kind, username), '', closing].join('\n'),
  }
}

export const testEmail = (): MailMessage => ({
  html: page(paragraphs(['This is a test mail from your Aurboda server. Its email settings work.'])),
  subject: 'Aurboda test mail',
  text: 'This is a test mail from your Aurboda server. Its email settings work.',
})
