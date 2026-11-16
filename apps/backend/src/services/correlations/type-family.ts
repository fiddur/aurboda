export interface TypeParentLink {
  name: string
  parent_type?: string | null
}

export type TypeAncestors = ReadonlyMap<string, readonly string[]>

/** Every defined type's ancestors, nearest first; a parent without a definition still counts, a cycle stops. */
export const ancestorsByType = (definitions: readonly TypeParentLink[]): Map<string, string[]> => {
  const parentOf = new Map(
    definitions.flatMap((d) => (d.parent_type ? [[d.name, d.parent_type] as [string, string]] : [])),
  )
  return new Map(
    definitions.map((d) => {
      const seen = new Set([d.name])
      const ancestors: string[] = []
      for (let parent = parentOf.get(d.name); parent !== undefined && !seen.has(parent); ) {
        seen.add(parent)
        ancestors.push(parent)
        parent = parentOf.get(parent)
      }
      return [d.name, ancestors]
    }),
  )
}

/** The type itself, then its ancestors nearest first. */
export const typeAndAncestors = (type: string, ancestors: TypeAncestors): string[] => [
  type,
  ...(ancestors.get(type) ?? []),
]
