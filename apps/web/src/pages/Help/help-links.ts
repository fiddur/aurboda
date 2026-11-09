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
