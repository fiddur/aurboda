import { type DartArg, type DartFunction, type DartItem, type DartNode, printDart } from './dart-reader.ts'

/** Program group → weight, later keys winning. */
export type Assignment = Map<string, number>

export interface TweakValue {
  defaultKey: string
  /** Option key → the option's `va` expression. */
  options: Map<string, DartNode>
}

export interface DartScope {
  /** Top-level value declarations of volume_assignment.dart and tweak.dart. */
  declarations: Map<string, DartNode>
  /** Top-level arrow functions of tweak.dart, such as `hipAbductionHipFlexion(defaultValue)`. */
  functions: Map<string, DartFunction>
}

const substituteArgs = (args: DartArg[], env: Map<string, DartNode>): DartArg[] =>
  args.map((a) => ({ ...a, value: substitute(a.value, env) }))

const substituteItems = (items: DartItem[], env: Map<string, DartNode>): DartItem[] =>
  items.map((item) =>
    'spread' in item ? { spread: substitute(item.spread, env) } : { value: substitute(item.value, env) },
  )

/** Replaces references to function parameters by the call's arguments. */
const substitute = (node: DartNode, env: Map<string, DartNode>): DartNode => {
  switch (node.kind) {
    case 'ref':
      return env.get(node.name) ?? node
    case 'member':
    case 'bang':
      return { ...node, target: substitute(node.target, env) }
    case 'index':
      return { ...node, index: substitute(node.index, env), target: substitute(node.target, env) }
    case 'call':
      return { ...node, args: substituteArgs(node.args, env), callee: substitute(node.callee, env) }
    case 'record':
      return { ...node, items: substituteArgs(node.items, env) }
    case 'list':
    case 'set':
      return { ...node, items: substituteItems(node.items, env) }
    case 'map':
      return {
        ...node,
        entries: node.entries.map((e) =>
          'spread' in e
            ? { spread: substitute(e.spread, env) }
            : { key: substitute(e.key, env), value: substitute(e.value, env) },
        ),
      }
    default:
      return node
  }
}

const calleeName = (node: DartNode): string | undefined =>
  node.kind === 'call' && node.callee.kind === 'ref' ? node.callee.name : undefined

const positional = (node: DartNode & { kind: 'call' }): DartNode[] =>
  node.args.filter((a) => !a.name).map((a) => a.value)

const assignWeight = (node: DartNode): number => {
  const first = node.kind === 'call' ? positional(node)[0] : undefined
  if (calleeName(node) !== 'Assign' || first?.kind !== 'num') {
    throw new Error(`Expected Assign(<number>, …), got ${printDart(node)}`)
  }
  return first.value
}

const groupKey = (node: DartNode): string => {
  if (node.kind !== 'member' || node.target.kind !== 'ref' || node.target.name !== 'ProgramGroup') {
    throw new Error(`Expected ProgramGroup.<name>, got ${printDart(node)}`)
  }
  return node.name
}

/** `<tweak>.opts['<key>']!.va`: the tweak expression and the option key, else undefined. */
const optionVaReference = (node: DartNode): { key: string; tweak: DartNode } | undefined => {
  if (node.kind !== 'member' || node.name !== 'va') return undefined
  const indexed = node.target.kind === 'bang' ? node.target.target : node.target
  if (indexed.kind !== 'index' || indexed.index.kind !== 'str') return undefined
  const opts = indexed.target
  if (opts.kind !== 'member' || opts.name !== 'opts') return undefined
  return { key: indexed.index.value, tweak: opts.target }
}

export const createRecruitmentResolver = ({ declarations, functions }: DartScope) => {
  const resolving = new Set<string>()

  const declared = (name: string): DartNode => {
    const node = declarations.get(name)
    if (!node) throw new Error(`Unresolved identifier: ${name}`)
    if (resolving.has(name)) throw new Error(`Circular reference: ${name}`)
    return node
  }

  const withName = <T>(name: string, resolve: (node: DartNode) => T): T => {
    const node = declared(name)
    resolving.add(name)
    try {
      return resolve(node)
    } finally {
      resolving.delete(name)
    }
  }

  const options = (node: DartNode): Map<string, DartNode> => {
    if (node.kind !== 'map') throw new Error(`Expected a map of tweak options, got ${printDart(node)}`)
    const out = new Map<string, DartNode>()
    for (const entry of node.entries) {
      if ('spread' in entry) {
        const { spread } = entry
        if (spread.kind !== 'member' || spread.name !== 'opts') {
          throw new Error(`Unresolved tweak option spread: ${printDart(spread)}`)
        }
        for (const [k, v] of tweak(spread.target).options) out.set(k, v)
        continue
      }
      const va = entry.value.kind === 'call' ? positional(entry.value)[0] : undefined
      if (entry.key.kind !== 'str' || calleeName(entry.value) !== 'Option' || !va) {
        throw new Error(`Expected '<key>': Option(<va>, …), got ${printDart(entry.value)}`)
      }
      out.set(entry.key.value, va)
    }
    return out
  }

  const callFunction = (node: DartNode & { kind: 'call' }, fn: DartFunction): TweakValue => {
    const args = positional(node)
    if (args.length !== fn.params.length) throw new Error(`Wrong argument count: ${printDart(node)}`)
    return tweak(substitute(fn.body, new Map(fn.params.map((p, i) => [p, args[i] as DartNode]))))
  }

  const tweak = (node: DartNode): TweakValue => {
    if (node.kind === 'ref') return withName(node.name, tweak)
    const name = calleeName(node)
    const fn = name === undefined ? undefined : functions.get(name)
    if (node.kind === 'call' && fn) return callFunction(node, fn)
    if (node.kind !== 'call' || name !== 'Tweak') throw new Error(`Unresolved tweak: ${printDart(node)}`)
    const [, defaultKey, opts] = positional(node)
    if (defaultKey?.kind !== 'str' || !opts) {
      throw new Error(`Malformed tweak: ${printDart(node).slice(0, 120)}`)
    }
    return { defaultKey: defaultKey.value, options: options(opts) }
  }

  const volume = (node: DartNode): Assignment => {
    if (node.kind === 'ref') return withName(node.name, volume)
    const optionRef = optionVaReference(node)
    if (optionRef) {
      const va = tweak(optionRef.tweak).options.get(optionRef.key)
      if (!va) throw new Error(`Unresolved tweak option: ${printDart(node)}`)
      return volume(va)
    }
    if (node.kind !== 'map') throw new Error(`Unresolved volume assignment: ${printDart(node)}`)
    const out: Assignment = new Map()
    for (const entry of node.entries) {
      if ('spread' in entry) {
        for (const [k, v] of volume(entry.spread)) out.set(k, v)
      } else {
        out.set(groupKey(entry.key), assignWeight(entry.value))
      }
    }
    return out
  }

  /** The default option's `va` of a tweak, or nothing when the default is not among its options. */
  const defaultVolume = (node: DartNode): Assignment => {
    const { defaultKey, options: opts } = tweak(node)
    const va = opts.get(defaultKey)
    return va ? volume(va) : new Map()
  }

  /** An exercise's volume assignment overlaid with each tweak's default option, later entries winning. */
  const recruitment = (va: DartNode, tweaks: DartNode | undefined): Assignment => {
    const out = new Map(volume(va))
    if (tweaks === undefined) return out
    if (tweaks.kind !== 'list') throw new Error(`Expected a list of tweaks, got ${printDart(tweaks)}`)
    for (const item of tweaks.items) {
      if ('spread' in item) throw new Error(`Unresolved tweak spread: ${printDart(item.spread)}`)
      for (const [k, v] of defaultVolume(item.value)) out.set(k, v)
    }
    return out
  }

  return { recruitment, tweak, volume }
}
