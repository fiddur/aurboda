import {
  type ExerciseEquipment,
  exerciseEquipment,
  exerciseEquipmentInfo,
  type ExerciseMuscle,
  exerciseMuscleGroups,
  exerciseMuscleInfo,
} from '@aurboda/api-spec'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useEffect, useRef, useState } from 'preact/hooks'

import { useDebounced } from '../../components/useDebounced'
import { fetchActivityFieldValues, searchExerciseCatalog } from '../../state/api'
import { SETS_PATH, STRENGTH_TYPE } from './constants'
import { buildPickerSections, type PickerItem, type PickerSection, recentExercises } from './picker'
import { useRecentStrengthSessions } from './queries'
import { recentSessionSets } from './startModel'

type Filter = { kind: 'muscle'; value: ExerciseMuscle } | { kind: 'equipment'; value: ExerciseEquipment }

const MUSCLE_OPTIONS = exerciseMuscleGroups.map((m) => ({ label: exerciseMuscleInfo[m].name, value: m }))
const EQUIPMENT_OPTIONS = exerciseEquipment
  .map((e) => ({ label: exerciseEquipmentInfo[e].name, value: e }))
  .sort((a, b) => a.label.localeCompare(b.label))

const CATALOG_LIMIT = 20
const DEBOUNCE_MS = 200

const itemMeta = (item: PickerItem): string | undefined => {
  if (item.kind === 'catalog') return item.hint
  if (item.kind === 'own' && item.count !== undefined) {
    return item.last_used
      ? `${item.count}× · ${format(new Date(item.last_used), 'd MMM yyyy')}`
      : `${item.count}×`
  }
  return undefined
}

const filterLabel = (filter: Filter): string =>
  filter.kind === 'muscle' ? exerciseMuscleInfo[filter.value].name : exerciseEquipmentInfo[filter.value].name

const catalogQueryFor = (typed: string, filter: Filter | undefined) => ({
  limit: CATALOG_LIMIT,
  ...(typed ? { q: typed } : {}),
  ...(filter?.kind === 'muscle' ? { muscle: filter.value } : {}),
  ...(filter?.kind === 'equipment' ? { equipment: filter.value } : {}),
})

const FilterChips = ({
  filter,
  choosing,
  onAll,
  onChoose,
}: {
  filter: Filter | undefined
  choosing: Filter['kind'] | undefined
  onAll: () => void
  onChoose: (kind: Filter['kind']) => void
}) => (
  <div class="strength-chips" role="group" aria-label="Filter the catalogue">
    <button type="button" class={`strength-chip${!filter && !choosing ? ' active' : ''}`} onClick={onAll}>
      All
    </button>
    {(['muscle', 'equipment'] as const).map((kind) => (
      <button
        key={kind}
        type="button"
        class={`strength-chip${filter?.kind === kind || choosing === kind ? ' active' : ''}`}
        onClick={() => onChoose(kind)}
      >
        {filter?.kind === kind ? filterLabel(filter) : kind === 'muscle' ? 'Muscle group' : 'Equipment'}
      </button>
    ))}
  </div>
)

const FilterValues = ({ kind, onPick }: { kind: Filter['kind']; onPick: (filter: Filter) => void }) => (
  <ul class="strength-picker-list strength-filter-values">
    {(kind === 'muscle' ? MUSCLE_OPTIONS : EQUIPMENT_OPTIONS).map((o) => (
      <li key={o.value}>
        <button
          type="button"
          class="strength-picker-row"
          onClick={() => onPick({ kind, value: o.value } as Filter)}
        >
          <span class="strength-picker-name">{o.label}</span>
        </button>
      </li>
    ))}
  </ul>
)

const Sections = ({
  sections,
  onPick,
}: {
  sections: PickerSection[]
  onPick: (item: PickerItem) => void
}) => (
  <>
    {sections.map((section, i) => (
      <section key={section.title ?? `s${i}`} class="strength-picker-section">
        {section.title && <h3>{section.title}</h3>}
        <ul class="strength-picker-list">
          {section.items.map((item) => (
            <li key={`${item.kind}:${item.value}`}>
              <button type="button" class="strength-picker-row" onClick={() => onPick(item)}>
                <span class="strength-picker-name">
                  {item.kind === 'new' ? `Use "${item.value}" as a new exercise name` : item.value}
                </span>
                {itemMeta(item) && <span class="strength-picker-meta">{itemMeta(item)}</span>}
              </button>
            </li>
          ))}
        </ul>
      </section>
    ))}
  </>
)

export const ExercisePicker = ({
  sessionId,
  onPick,
  onClose,
}: {
  sessionId?: string
  onPick: (exercise: string, catalogKey?: string) => void
  onClose: () => void
}) => {
  const [text, setText] = useState('')
  const [filter, setFilter] = useState<Filter | undefined>()
  const [choosing, setChoosing] = useState<'muscle' | 'equipment' | undefined>()
  const searchRef = useRef<HTMLInputElement>(null)
  const typed = useDebounced(text.trim(), DEBOUNCE_MS)

  useEffect(() => {
    searchRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const own = useQuery({
    queryFn: () => fetchActivityFieldValues(STRENGTH_TYPE, SETS_PATH),
    queryKey: ['activity-field-values', STRENGTH_TYPE, SETS_PATH],
    staleTime: 5 * 60 * 1000,
  })
  const recent = useRecentStrengthSessions()

  const catalogQuery = catalogQueryFor(typed, filter)
  const catalog = useQuery({
    enabled: typed !== '' || filter !== undefined,
    placeholderData: keepPreviousData,
    queryFn: () => searchExerciseCatalog(catalogQuery),
    queryKey: ['exercise-catalog', 'strength-picker', catalogQuery],
    staleTime: 30 * 60 * 1000,
  })

  const sections = buildPickerSections({
    catalog: typed !== '' || filter ? (catalog.data?.entries ?? []) : [],
    own: own.data?.values ?? [],
    recent: recentExercises(recentSessionSets(recent.data ?? [], sessionId)),
    text,
  })

  return (
    <div class="strength-picker" role="dialog" aria-modal="true" aria-label="Add exercise">
      <div class="strength-picker-header">
        <button type="button" class="btn-secondary" onClick={onClose}>
          ← Back
        </button>
        <h2>Add exercise</h2>
      </div>
      <input
        ref={searchRef}
        type="search"
        class="strength-picker-search"
        aria-label="Search your exercises and the catalogue"
        placeholder="Search your exercises and the catalogue"
        value={text}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
      />
      <FilterChips
        filter={filter}
        choosing={choosing}
        onAll={() => {
          setFilter(undefined)
          setChoosing(undefined)
        }}
        onChoose={(kind) => setChoosing(choosing === kind ? undefined : kind)}
      />
      {choosing && (
        <FilterValues
          kind={choosing}
          onPick={(f) => {
            setFilter(f)
            setChoosing(undefined)
          }}
        />
      )}
      {!choosing && (
        <Sections
          sections={sections}
          onPick={(item) => onPick(item.value, item.kind === 'catalog' ? item.key : undefined)}
        />
      )}
      {!choosing && sections.length === 0 && (
        <p class="strength-muted">{own.isLoading ? 'Loading…' : 'Type the name of an exercise.'}</p>
      )}
    </div>
  )
}
