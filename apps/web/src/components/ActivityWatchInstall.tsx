import { useState } from 'preact/hooks'

import { API_URL } from '../config'
import { generateApiToken } from '../state/api'
import {
  absoluteApiUrl,
  detectInstallOs,
  type InstallOs,
  installCommand,
  installOses,
  maskedInstallCommand,
} from './activitywatch-install'
import './ActivityWatchInstall.css'

interface Props {
  manualHref: string
}

const initialOs = (): InstallOs =>
  typeof navigator === 'undefined' ? 'linux' : detectInstallOs(navigator.userAgent, navigator.platform ?? '')

/** OS tabs and the one-line ActivityWatch installer command, with the user's key fetched on request. */
export function ActivityWatchInstall({ manualHref }: Props) {
  const [os, setOs] = useState<InstallOs>(initialOs)
  const [token, setToken] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'copied'>('idle')
  const apiUrl = absoluteApiUrl(API_URL, window.location.origin)

  const showCommand = async () => {
    setStatus('loading')
    try {
      setToken(await generateApiToken())
      setStatus('idle')
    } catch {
      setStatus('error')
    }
  }

  const copyCommand = () => {
    if (!token) return
    navigator.clipboard.writeText(installCommand(os, apiUrl, token)).then(() => {
      setStatus('copied')
      setTimeout(() => setStatus('idle'), 2000)
    })
  }

  return (
    <div class="aw-install">
      <div class="aw-install-tabs" role="tablist" aria-label="Operating system">
        {installOses.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={os === option.id}
            class={`aw-install-tab${os === option.id ? ' active' : ''}`}
            onClick={() => setOs(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div class="aw-install-box">
        {token ? (
          <>
            <code class="aw-install-command">{maskedInstallCommand(os, apiUrl, token)}</code>
            <button type="button" class="aw-install-copy" onClick={copyCommand}>
              {status === 'copied' ? 'Copied!' : 'Copy'}
            </button>
          </>
        ) : (
          <button
            type="button"
            class="aw-install-reveal"
            onClick={showCommand}
            disabled={status === 'loading'}
          >
            {status === 'loading' ? 'Creating your key…' : 'Show my command'}
          </button>
        )}
      </div>

      {status === 'error' && <p class="aw-install-error">Could not create your key. Try again.</p>}
      <p class="aw-install-note">
        {os === 'windows'
          ? 'Paste it into PowerShell.'
          : `Paste it into a terminal${os === 'mac' ? ' (Terminal app)' : ''}.`}{' '}
        The command contains your personal key; don't share it.
      </p>
      <a class="aw-install-manual" href={manualHref}>
        Prefer to do it by hand?
      </a>
    </div>
  )
}
