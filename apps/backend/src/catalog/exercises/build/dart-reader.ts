/**
 * A reader for the small subset of Dart that body.build's dataset files use: literals, references,
 * calls, member access, indexing and records. It is not a general Dart parser.
 */

export type DartNode =
  | { kind: 'str'; value: string }
  | { kind: 'num'; value: number }
  | { kind: 'list'; items: DartItem[] }
  | { kind: 'map'; entries: DartMapEntry[] }
  | { kind: 'set'; items: DartItem[] }
  | { kind: 'ref'; name: string }
  | { kind: 'member'; target: DartNode; name: string }
  | { kind: 'call'; callee: DartNode; args: DartArg[] }
  | { kind: 'index'; target: DartNode; index: DartNode }
  | { kind: 'bang'; target: DartNode }
  | { kind: 'record'; items: DartArg[] }

export type DartItem = { spread: DartNode } | { value: DartNode }
export type DartMapEntry = { spread: DartNode } | { key: DartNode; value: DartNode }
export interface DartArg {
  name?: string
  value: DartNode
}

type Token =
  | { kind: 'str'; value: string }
  | { kind: 'num'; value: number }
  | { kind: 'ident'; value: string }
  | { kind: 'punct'; value: string }

const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c)
const isIdentChar = (c: string) => /[A-Za-z0-9_$]/.test(c)

const quoteAt = (src: string, i: number): string | undefined => {
  const c = src[i]
  if (c !== "'" && c !== '"') return undefined
  return src.startsWith(c.repeat(3), i) ? c.repeat(3) : c
}

const rawPrefixAt = (src: string, i: number): boolean =>
  src[i] === 'r' && quoteAt(src, i + 1) !== undefined && (i === 0 || !isIdentChar(src[i - 1] ?? ''))

const skipInterpolation = (src: string, from: number): number => {
  let depth = 1
  let i = from
  while (i < src.length) {
    if (rawPrefixAt(src, i) || quoteAt(src, i)) {
      i = readString(src, i).end
      continue
    }
    if (src[i] === '{') depth += 1
    if (src[i] === '}') depth -= 1
    i += 1
    if (depth === 0) return i
  }
  throw new Error(`Unterminated interpolation at offset ${from}`)
}

const ESCAPES: Record<string, string> = { n: '\n', t: '\t' }

/** One step inside a non-raw string body: an escape or an interpolation, else undefined. */
const readSpecial = (src: string, i: number): { end: number; text: string } | undefined => {
  if (src[i] === '\\') {
    const next = src[i + 1] ?? ''
    return { end: i + 2, text: ESCAPES[next] ?? next }
  }
  if (src[i] === '$' && src[i + 1] === '{') {
    const end = skipInterpolation(src, i + 2)
    return { end, text: src.slice(i, end) }
  }
  return undefined
}

/** Reads a string literal starting at `i` (at its quote, or at an `r` prefix). */
const readString = (src: string, start: number): { end: number; value: string } => {
  const raw = src[start] === 'r'
  const open = raw ? start + 1 : start
  const quote = quoteAt(src, open)
  if (!quote) throw new Error(`No string literal at offset ${start}`)
  let i = open + quote.length
  let value = ''
  while (i < src.length) {
    if (src.startsWith(quote, i)) return { end: i + quote.length, value }
    const special = raw ? undefined : readSpecial(src, i)
    if (special) {
      value += special.text
      i = special.end
      continue
    }
    if (quote.length === 1 && src[i] === '\n') break
    value += src[i]
    i += 1
  }
  throw new Error(`Unterminated string at offset ${start}`)
}

/** Replaces `//` and (nesting) `/* *\/` comments by spaces, leaving string literals alone. */
export const stripComments = (src: string): string => {
  let out = ''
  let i = 0
  while (i < src.length) {
    if (rawPrefixAt(src, i) || quoteAt(src, i)) {
      const { end } = readString(src, i)
      out += src.slice(i, end)
      i = end
    } else if (src.startsWith('//', i)) {
      const nl = src.indexOf('\n', i)
      i = nl === -1 ? src.length : nl
      out += ' '
    } else if (src.startsWith('/*', i)) {
      let depth = 0
      while (i < src.length) {
        if (src.startsWith('/*', i)) {
          depth += 1
          i += 2
        } else if (src.startsWith('*/', i)) {
          depth -= 1
          i += 2
          if (depth === 0) break
        } else {
          i += 1
        }
      }
      if (depth !== 0) throw new Error('Unterminated block comment')
      out += ' '
    } else {
      out += src[i]
      i += 1
    }
  }
  return out
}

const PUNCTS = ['...', '=>', '??', '?.', '==', '!=', '<=', '>=', '&&', '||']

type TokenReader = (src: string, i: number, tokens: Token[]) => number | undefined

const readSpace: TokenReader = (src, i) => (/\s/.test(src[i] ?? '') ? i + 1 : undefined)

const readStringToken: TokenReader = (src, i, tokens) => {
  if (!rawPrefixAt(src, i) && !quoteAt(src, i)) return undefined
  const { end, value } = readString(src, i)
  const last = tokens.at(-1)
  if (last?.kind === 'str') last.value += value
  else tokens.push({ kind: 'str', value })
  return end
}

const readNumber: TokenReader = (src, i, tokens) => {
  const text = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i))?.[0]
  if (!text) return undefined
  tokens.push({ kind: 'num', value: Number(text) })
  return i + text.length
}

const readIdent: TokenReader = (src, i, tokens) => {
  if (!isIdentStart(src[i] ?? '')) return undefined
  let j = i
  while (j < src.length && isIdentChar(src[j] ?? '')) j += 1
  tokens.push({ kind: 'ident', value: src.slice(i, j) })
  return j
}

const readPunct: TokenReader = (src, i, tokens) => {
  const p = PUNCTS.find((candidate) => src.startsWith(candidate, i)) ?? src[i] ?? ''
  tokens.push({ kind: 'punct', value: p })
  return i + p.length
}

const TOKEN_READERS = [readSpace, readStringToken, readNumber, readIdent, readPunct]

export const tokenize = (source: string): Token[] => {
  const src = stripComments(source)
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const at = i
    i =
      TOKEN_READERS.reduce<number | undefined>((end, read) => end ?? read(src, at, tokens), undefined) ??
      i + 1
  }
  return tokens
}

export interface DartParser {
  /** Top-level value declarations (`const x =`, `final x =`, `Tweak x =`, …): name → expression. */
  declarations: () => Map<string, DartNode>
  /** The expression assigned to the first top-level-or-nested `<name> =`. */
  assignment: (name: string) => DartNode
  /** The values of `enum <name> { a(...), b(...); ... }`, in order. */
  enumValues: (name: string) => string[]
  /** Top-level arrow functions `Type name(params) => body;`: name → parameters and body. */
  functions: () => Map<string, DartFunction>
}

export interface DartFunction {
  body: DartNode
  name: string
  params: string[]
}

export const parseDart = (source: string): DartParser => {
  const tokens = tokenize(source)
  let pos = 0

  const peek = (offset = 0): Token | undefined => tokens[pos + offset]
  const isPunct = (value: string, offset = 0) => {
    const t = peek(offset)
    return t?.kind === 'punct' && t.value === value
  }
  const expect = (value: string) => {
    if (!isPunct(value)) {
      const t = peek()
      throw new Error(
        `Expected '${value}' but found '${t ? String(t.value) : 'end of file'}' at token ${pos}`,
      )
    }
    pos += 1
  }

  const parseItems = (close: string): DartItem[] => {
    const items: DartItem[] = []
    while (!isPunct(close)) {
      if (isPunct('...')) {
        pos += 1
        items.push({ spread: parseExpr() })
      } else {
        items.push({ value: parseExpr() })
      }
      if (!isPunct(close)) expect(',')
    }
    expect(close)
    return items
  }

  const parseBrace = (): DartNode => {
    expect('{')
    const entries: DartMapEntry[] = []
    const setItems: DartItem[] = []
    while (!isPunct('}')) {
      if (isPunct('...')) {
        pos += 1
        const spread = parseExpr()
        entries.push({ spread })
        setItems.push({ spread })
      } else {
        const key = parseExpr()
        if (isPunct(':')) {
          pos += 1
          entries.push({ key, value: parseExpr() })
        } else {
          setItems.push({ value: key })
        }
      }
      if (!isPunct('}')) expect(',')
    }
    expect('}')
    const isSet = setItems.some((item) => 'value' in item)
    return isSet ? { items: setItems, kind: 'set' } : { entries, kind: 'map' }
  }

  const parseArgs = (close: string): DartArg[] => {
    const args: DartArg[] = []
    while (!isPunct(close)) {
      const t = peek()
      if (t?.kind === 'ident' && isPunct(':', 1)) {
        pos += 2
        args.push({ name: t.value, value: parseExpr() })
      } else {
        args.push({ value: parseExpr() })
      }
      if (!isPunct(close)) expect(',')
    }
    expect(close)
    return args
  }

  const parsePrimary = (): DartNode => {
    const t = peek()
    if (!t) throw new Error('Unexpected end of file')
    if (t.kind === 'ident' && (t.value === 'const' || t.value === 'final')) {
      pos += 1
      return parsePrimary()
    }
    if (t.kind === 'str' || t.kind === 'num') {
      pos += 1
      return t.kind === 'str' ? { kind: 'str', value: t.value } : { kind: 'num', value: t.value }
    }
    if (t.kind === 'ident') {
      pos += 1
      if (isPunct('<')) skipTypeArguments()
      return { kind: 'ref', name: t.value }
    }
    if (t.value === '[') {
      pos += 1
      return { items: parseItems(']'), kind: 'list' }
    }
    if (t.value === '{') return parseBrace()
    if (t.value === '(') {
      pos += 1
      return { items: parseArgs(')'), kind: 'record' }
    }
    if (t.value === '<') {
      skipTypeArguments()
      return parsePrimary()
    }
    throw new Error(`Unexpected '${t.value}' at token ${pos}`)
  }

  const skipTypeArguments = () => {
    let depth = 0
    do {
      if (isPunct('<')) depth += 1
      if (isPunct('>')) depth -= 1
      pos += 1
    } while (depth > 0 && pos < tokens.length)
  }

  const parseExpr = (): DartNode => {
    let node = parsePrimary()
    for (;;) {
      if (isPunct('.')) {
        pos += 1
        const name = peek()
        if (name?.kind !== 'ident') throw new Error(`Expected a member name at token ${pos}`)
        pos += 1
        node = { kind: 'member', name: name.value, target: node }
      } else if (isPunct('(')) {
        pos += 1
        node = { args: parseArgs(')'), callee: node, kind: 'call' }
      } else if (isPunct('[')) {
        pos += 1
        const index = parseExpr()
        expect(']')
        node = { index, kind: 'index', target: node }
      } else if (isPunct('!')) {
        pos += 1
        node = { kind: 'bang', target: node }
      } else {
        return node
      }
    }
  }

  const atStatementStart = () => {
    const prev = tokens[pos - 1]
    return prev === undefined || (prev.kind === 'punct' && (prev.value === ';' || prev.value === '}'))
  }

  /** `const x =`, `final x =`, `Tweak x =`, `const Tweak x =`: the name and the tokens up to the `=`. */
  const valueDeclarationAt = (): { name: string; skip: number } | undefined => {
    let n = 0
    while (peek(n)?.kind === 'ident') n += 1
    const first = String(peek()?.value)
    if (n < 2 || !isPunct('=', n) || first === 'typedef' || first === 'import') return undefined
    return { name: String(peek(n - 1)?.value), skip: n + 1 }
  }

  /** `Type name(Type param, …) => body;`: the name, parameter names and the tokens up to the body. */
  const functionDeclarationAt = (): (Omit<DartFunction, 'body'> & { skip: number }) | undefined => {
    if (peek()?.kind !== 'ident' || peek(1)?.kind !== 'ident' || !isPunct('(', 2)) return undefined
    const params: string[] = []
    let n = 3
    while (peek(n) && !isPunct(')', n)) {
      if (peek(n)?.kind === 'ident' && (isPunct(',', n + 1) || isPunct(')', n + 1))) {
        params.push(String(peek(n)?.value))
      }
      n += 1
    }
    if (!isPunct('=>', n + 1)) return undefined
    return { name: String(peek(1)?.value), params, skip: n + 2 }
  }

  const depthChange = (t: Token | undefined): number => {
    if (t?.kind !== 'punct') return 0
    if (['{', '(', '['].includes(t.value)) return 1
    return ['}', ')', ']'].includes(t.value) ? -1 : 0
  }

  const scanTopLevel = (visit: () => boolean) => {
    pos = 0
    let depth = 0
    while (pos < tokens.length) {
      if (depth === 0 && atStatementStart() && visit()) continue
      depth += depthChange(peek())
      pos += 1
    }
  }

  const declarations = () => {
    const found = new Map<string, DartNode>()
    scanTopLevel(() => {
      const declaration = valueDeclarationAt()
      if (!declaration) return false
      pos += declaration.skip
      found.set(declaration.name, parseExpr())
      expect(';')
      return true
    })
    return found
  }

  const functions = () => {
    const found = new Map<string, DartFunction>()
    scanTopLevel(() => {
      const declaration = functionDeclarationAt()
      if (!declaration) return false
      pos += declaration.skip
      found.set(declaration.name, { body: parseExpr(), name: declaration.name, params: declaration.params })
      expect(';')
      return true
    })
    return found
  }

  const assignment = (name: string) => {
    const at = tokens.findIndex(
      (t, i) => t.kind === 'ident' && t.value === name && tokens[i + 1]?.value === '=',
    )
    if (at === -1) throw new Error(`No assignment to '${name}'`)
    pos = at + 2
    return parseExpr()
  }

  const enumValues = (name: string) => {
    const at = tokens.findIndex(
      (t, i) => t.kind === 'ident' && t.value === 'enum' && tokens[i + 1]?.value === name,
    )
    if (at === -1) throw new Error(`No enum '${name}'`)
    pos = at + 2
    expect('{')
    const values: string[] = []
    for (;;) {
      const node = parseExpr()
      const ref = node.kind === 'call' ? node.callee : node
      if (ref.kind !== 'ref') throw new Error(`Unexpected enum value in '${name}'`)
      values.push(ref.name)
      if (isPunct(';') || isPunct('}')) return values
      expect(',')
      if (isPunct(';') || isPunct('}')) return values
    }
  }

  return { assignment, declarations, enumValues, functions }
}

const printArgs = (args: DartArg[]) =>
  args.map((a) => (a.name ? `${a.name}: ${printDart(a.value)}` : printDart(a.value))).join(', ')

const printItems = (items: DartItem[]) =>
  items.map((item) => ('spread' in item ? `...${printDart(item.spread)}` : printDart(item.value))).join(', ')

/** A compact Dart rendering of a node, for error messages and for recognising a known expression. */
export const printDart = (node: DartNode): string => {
  switch (node.kind) {
    case 'str':
      return `'${node.value}'`
    case 'num':
      return String(node.value)
    case 'ref':
      return node.name
    case 'member':
      return `${printDart(node.target)}.${node.name}`
    case 'call':
      return `${printDart(node.callee)}(${printArgs(node.args)})`
    case 'index':
      return `${printDart(node.target)}[${printDart(node.index)}]`
    case 'bang':
      return `${printDart(node.target)}!`
    case 'record':
      return `(${printArgs(node.items)})`
    case 'list':
      return `[${printItems(node.items)}]`
    case 'set':
      return `{${printItems(node.items)}}`
    case 'map':
      return `{${node.entries
        .map((e) =>
          'spread' in e ? `...${printDart(e.spread)}` : `${printDart(e.key)}: ${printDart(e.value)}`,
        )
        .join(', ')}}`
  }
}
