/**
 * Writes the shared menu (`menu.ts`) as Kotlin, for the Android app's More tab.
 *
 * Run with: pnpm generate:kotlin:menu
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  APP_ONLY_LINKS,
  HELP_LINK,
  MENU_ALWAYS_SHOWN,
  NAV_SECTIONS,
  NAV_TOP_LINKS,
  type NavLink,
  type NavSection,
  NOTIFICATIONS_LINK,
  SETTINGS_LINK,
} from './menu.ts'

const outFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../generated/kotlin/src/main/kotlin/net/aurboda/api/menu/NavMenu.kt',
)

const kotlinString = (value: string): string =>
  `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('$', '\\$')}"`

const navLink = (link: NavLink): string => {
  const args = [`href = ${kotlinString(link.href)}`, `label = ${kotlinString(link.label)}`]
  if (link.icon !== undefined) args.push(`icon = ${kotlinString(link.icon)}`)
  if (link.adminOnly) args.push('adminOnly = true')
  return `NavLink(${args.join(', ')})`
}

const indent = (text: string, spaces: number): string =>
  text
    .split('\n')
    .map((line) => (line ? ' '.repeat(spaces) + line : line))
    .join('\n')

const listOf = (items: string[]): string =>
  items.length === 0 ? 'listOf()' : `listOf(\n${items.map((item) => indent(`${item},`, 4)).join('\n')}\n)`

const navSection = (section: NavSection): string =>
  [
    'NavSection(',
    `    id = ${kotlinString(section.id)},`,
    `    label = ${kotlinString(section.label)},`,
    `    icon = ${kotlinString(section.icon)},`,
    `    links = ${indent(listOf(section.links.map(navLink)), 4).trimStart()},`,
    ')',
  ].join('\n')

const navMenuKotlin = (): string =>
  `// Generated from packages/api-spec/src/menu.ts by pnpm generate. Do not edit.
package net.aurboda.api.menu

data class NavLink(
    val href: String,
    val label: String,
    val icon: String? = null,
    val adminOnly: Boolean = false,
)

data class NavSection(
    val id: String,
    val label: String,
    val icon: String,
    val links: List<NavLink>,
)

val navTopLinks: List<NavLink> = ${listOf(NAV_TOP_LINKS.map(navLink))}

val navSections: List<NavSection> = ${listOf(NAV_SECTIONS.map(navSection))}

val helpLink: NavLink = ${navLink(HELP_LINK)}

val settingsLink: NavLink = ${navLink(SETTINGS_LINK)}

val notificationsLink: NavLink = ${navLink(NOTIFICATIONS_LINK)}

val appOnlyLinks: List<NavLink> = ${listOf(APP_ONLY_LINKS.map(navLink))}

val menuAlwaysShown: List<String> = listOf(${MENU_ALWAYS_SHOWN.map(kotlinString).join(', ')})
`

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, navMenuKotlin())
console.info(`Wrote ${path.relative(process.cwd(), outFile)}`)
