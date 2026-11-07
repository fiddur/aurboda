export type InstallOs = 'linux' | 'mac' | 'windows'

export const installOses: { id: InstallOs; label: string }[] = [
  { id: 'linux', label: 'Linux' },
  { id: 'mac', label: 'Mac' },
  { id: 'windows', label: 'Windows' },
]

export const detectInstallOs = (userAgent: string, platform: string): InstallOs => {
  const text = `${platform} ${userAgent}`.toLowerCase()
  if (/\bwin(32|64|dows)\b/.test(text)) return 'windows'
  if (/\bmac/.test(text) && !/iphone|ipad|ipod/.test(text)) return 'mac'
  return 'linux'
}

/** The API base as an absolute URL, so the command works pasted into a terminal. */
export const absoluteApiUrl = (apiUrl: string, origin: string): string => {
  const base = /^https?:\/\//.test(apiUrl) ? apiUrl : `${origin}${apiUrl.startsWith('/') ? '' : '/'}${apiUrl}`
  return base.replace(/\/+$/, '')
}

export const installCommand = (os: InstallOs, apiUrl: string, token: string): string =>
  os === 'windows'
    ? `$env:AURBODA_TOKEN='${token}'; irm ${apiUrl}/agents/activitywatch.ps1 | iex`
    : `curl -fsSL ${apiUrl}/agents/activitywatch.sh | bash -s -- --token '${token}'`

/** Long enough to recognise a key, too short to use one. */
export const maskToken = (token: string): string => {
  const prefixed = /^([a-z]+_)[A-Za-z0-9+/=._-]{8,}$/.exec(token)
  if (prefixed) return `${prefixed[1]}…${token.slice(-4)}`
  if (token.length <= 8) return '…'
  return `${token.slice(0, 4)}…${token.slice(-4)}`
}

export const maskedInstallCommand = (os: InstallOs, apiUrl: string, token: string): string =>
  installCommand(os, apiUrl, maskToken(token))
