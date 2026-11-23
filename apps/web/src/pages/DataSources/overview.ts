import type {
  DataKindOverview,
  DataSourceGroupId,
  DataSourceId,
  DataSourceOverviewItem,
  DataSourcesOverview,
} from '@aurboda/api-spec'

export const joinNames = (names: string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

const namesOf = (ids: DataSourceId[], sources: DataSourceOverviewItem[]): string[] =>
  ids.map((id) => sources.find((source) => source.id === id)?.name ?? id)

export const overlapMessage = (kind: DataKindOverview, sources: DataSourceOverviewItem[]): string => {
  const names = namesOf(kind.active_sources, sources)
  const verb = names.length === 2 ? 'both send' : 'all send'
  return `${joinNames(names)} ${verb} ${kind.overlap_hint ?? kind.label.toLowerCase()}. One is enough.`
}

export interface OtherSourcesCovering {
  kind: DataKindOverview
  others: DataSourceOverviewItem[]
}

/** For each kind of the source where one source is enough, the other active sources that already bring it. */
export const otherSourcesCovering = (
  overview: DataSourcesOverview,
  sourceId: DataSourceId,
): OtherSourcesCovering[] =>
  overview.kinds.flatMap((kind) => {
    if (!kind.one_source_enough || !kind.available_sources.includes(sourceId)) return []
    const others = overview.sources.filter(
      (source) => source.id !== sourceId && kind.active_sources.includes(source.id),
    )
    return others.length > 0 ? [{ kind, others }] : []
  })

export const overlapNoteText = (
  { kind, others }: OtherSourcesCovering,
  self: DataSourceOverviewItem,
): string => {
  const names = joinNames(others.map((source) => source.name))
  const hint = kind.overlap_hint ?? kind.label.toLowerCase()
  if (self.status === 'active') {
    const verb = others.length === 1 ? 'also sends' : 'also send'
    return `${names} ${verb} ${hint}. One is enough: disconnect the one you don't need.`
  }
  return `You already get ${kind.label.toLowerCase()} from ${names}. ${self.name} would send ${hint} again. Set it up only to replace ${names}.`
}

export interface SourceGroup {
  id: DataSourceGroupId
  label: string
  sources: DataSourceOverviewItem[]
}

export const sourcesByGroup = (overview: DataSourcesOverview): SourceGroup[] =>
  overview.groups.flatMap((group) => {
    const sources = overview.sources.filter((source) => source.group === group.id)
    return sources.length > 0 ? [{ ...group, sources }] : []
  })
