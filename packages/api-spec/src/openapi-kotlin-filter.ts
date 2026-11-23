/**
 * The OpenAPI document the Kotlin models are generated from: the full document without the
 * paths whose timeline and feed entries carry the structured payload the Kotlin generator
 * cannot express, and without every schema only those paths reached.
 */

export const kotlinSkippedPaths: readonly string[] = ['/feed', '/people/{id}/posts']

export const isKotlinSkippedPath = (path: string): boolean =>
  kotlinSkippedPaths.some((skipped) => path === skipped || path.startsWith(`${skipped}/`))

interface OpenApiLike {
  components?: object
  paths?: object
}

type Components = Record<string, Record<string, unknown> | undefined>

const REF_PREFIX = '#/components/'

const collectRefs = (value: unknown, into: Set<string>): void => {
  if (value == null || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (key === '$ref' && typeof child === 'string' && child.startsWith(REF_PREFIX)) into.add(child)
    else collectRefs(child, into)
  }
}

const resolveRef = (components: Components, ref: string): unknown => {
  const [kind, name] = ref.slice(REF_PREFIX.length).split('/', 2)
  return components[kind]?.[name]
}

const reachableRefs = (components: Components, roots: unknown[], rootRefs: string[] = []): Set<string> => {
  const seen = new Set(rootRefs)
  const queue = [...rootRefs]
  const visit = (value: unknown) => {
    const found = new Set<string>()
    collectRefs(value, found)
    for (const ref of found) {
      if (seen.has(ref)) continue
      seen.add(ref)
      queue.push(ref)
    }
  }
  roots.forEach(visit)
  for (let ref = queue.pop(); ref !== undefined; ref = queue.pop()) visit(resolveRef(components, ref))
  return seen
}

const componentRefs = (components: Components): string[] =>
  Object.entries(components).flatMap(([kind, entries]) =>
    Object.keys(entries ?? {}).map((name) => `${REF_PREFIX}${kind}/${name}`),
  )

/**
 * Components no path reaches in the full document (a model registered for clients, such as
 * `WellKnownAurboda`) stay, with everything they reach: they were never there for a path.
 */
export const kotlinOpenApiDocument = <T extends OpenApiLike>(document: T): T => {
  const components = (document.components ?? {}) as Components
  const allPaths = (document.paths ?? {}) as Record<string, unknown>
  const reachedByPaths = reachableRefs(components, [allPaths])
  const registered = componentRefs(components).filter((ref) => !reachedByPaths.has(ref))
  const paths = Object.fromEntries(Object.entries(allPaths).filter(([path]) => !isKotlinSkippedPath(path)))
  const kept = reachableRefs(components, [paths], registered)
  const schemas = Object.fromEntries(
    Object.entries(components.schemas ?? {}).filter(([name]) => kept.has(`${REF_PREFIX}schemas/${name}`)),
  )
  return {
    ...document,
    paths,
    ...(document.components ? { components: { ...document.components, schemas } } : {}),
  }
}
