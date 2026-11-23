#!/usr/bin/env node
// Fails when a web style sheet holds a colour literal outside apps/web/src/styles/_tokens.scss.
// See docs/web-theme.md, "Styles".
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('..', import.meta.url))
const srcDir = join(repo, 'apps/web/src')
const tokensFile = 'styles/_tokens.scss'

const namedColours = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown ' +
    'burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan ' +
    'darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid ' +
    'darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet ' +
    'deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ' +
    'ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow ' +
    'lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
    'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine ' +
    'mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise ' +
    'mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab ' +
    'orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru ' +
    'pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
    'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan ' +
    'teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
)

// Properties whose values hold names that can collide with a colour name (a font, an animation).
const nonColourProperties =
  /^(font|font-family|content|animation|animation-name|transition|transition-property|will-change|grid-area|grid-template-areas|counter-reset|counter-increment|list-style|list-style-type|quotes)$/i

const styleFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return styleFiles(path)
    return /\.s?css$/.test(entry.name) ? [path] : []
  })

const blank = (text) => text.replace(/[^\n]/g, ' ')

// Comments, string contents and url() arguments become spaces, so offsets and line numbers stay put.
const strip = (text, isScss) => {
  let out = text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(["'])(?:\\.|(?!\1)[^\\\n])*\1/g, (s) => s[0] + blank(s.slice(1, -1)) + s[0])
    .replace(/\burl\((?:[^()]|\([^()]*\))*\)/gi, (s) => 'url(' + blank(s.slice(4, -1)) + ')')
  if (isScss) out = out.replace(/\/\/[^\n]*/g, blank)
  return out
}

const literalsIn = (prop, value) => {
  const found = []
  for (const m of value.matchAll(/#[0-9a-f]+(?![\w-])/gi))
    if ([4, 5, 7, 9].includes(m[0].length)) found.push(m[0])
  for (const m of value.matchAll(/\b(?:rgba?|hsla?)\(/gi)) found.push(m[0])
  if (!nonColourProperties.test(prop) && !prop.startsWith('$')) {
    for (const token of value.split(/[\s,()/]+/)) if (namedColours.has(token.toLowerCase())) found.push(token)
  }
  return found
}

const offenders = []
for (const path of styleFiles(srcDir)) {
  const file = relative(srcDir, path).split('\\').join('/')
  if (file === tokensFile) continue
  const text = strip(readFileSync(path, 'utf8'), file.endsWith('.scss'))
  for (const m of text.matchAll(/([$\w-]+)\s*:([^;{}]*)(?=[;}])/g)) {
    for (const literal of literalsIn(m[1], m[2])) {
      const line = text.slice(0, m.index).split('\n').length
      offenders.push(`apps/web/src/${file}:${line}: ${m[1]}: ${literal}`)
    }
  }
}

if (offenders.length) {
  console.error(offenders.join('\n'))
  console.error(
    `\n${offenders.length} colour literal(s) outside apps/web/src/${tokensFile}. Use a --color-* token or a palette ` +
      'property from that file (see docs/web-theme.md, "Styles").',
  )
  process.exit(1)
}
