import { docsUrl } from '../../utils/docs-url'

export interface HelpLink {
  href: string
  label: string
  description?: string
}

export const GITHUB = 'https://github.com/fiddur/aurboda'

export const DISCUSSION_LINKS: HelpLink[] = [
  { href: `${GITHUB}/discussions/new?category=q-a`, label: 'Ask a question' },
  { href: `${GITHUB}/discussions/new?category=ideas`, label: 'Suggest an idea' },
  { href: `${GITHUB}/discussions`, label: 'Browse existing discussions' },
]

export const BUG_REPORT_LINK: HelpLink = { href: `${GITHUB}/issues/new`, label: 'Report a bug' }

/** Links a server version to what it was built from: a release's notes, or a commit. */
export const versionLink = (version: string): HelpLink | undefined => {
  if (/^\d+\.\d+\.\d+$/.test(version)) {
    return { href: `${GITHUB}/releases/tag/v${version}`, label: version }
  }
  if (/^[0-9a-f]{7,40}$/.test(version)) {
    return { href: `${GITHUB}/commit/${version}`, label: version.slice(0, 7) }
  }
  return undefined
}

export const DOCS_LINKS: HelpLink[] = [
  {
    href: docsUrl('data-sources.md'),
    label: 'Data sources',
    description: 'every source Aurboda can sync, what it brings in and how to connect it',
  },
  {
    href: docsUrl('android-app.md'),
    label: 'The Android app',
    description: 'installing it, what it syncs and how it works in the background',
  },
  {
    href: docsUrl('health-connect.md'),
    label: 'Health Connect',
    description: 'bringing in data from your phone, watch or ring through Android',
  },
  {
    href: docsUrl('activitywatch.md'),
    label: 'ActivityWatch',
    description: 'tracking time at your computer',
  },
  {
    href: docsUrl('data-export.md'),
    label: 'Exporting your data',
    description: 'downloading everything, or moving to another server',
  },
  {
    href: docsUrl('mcp-server.md'),
    label: 'Connecting an AI assistant',
    description: 'asking your data questions in plain language',
  },
  {
    href: docsUrl('correlations.md'),
    label: 'Correlations',
    description: 'finding out what affects your sleep, mood or energy',
  },
]
