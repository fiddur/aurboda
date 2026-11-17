import type { ExerciseCatalogEntry } from '@aurboda/api-spec'

import { type ComponentChildren, Fragment } from 'preact'

import { isSameName } from '../../components/knownValueSuggestions'
import { muscleGroupHref } from '../../components/sessions/sessionView'
import { muscleTiers, type TierMuscle } from './catalogEntryView'

/** The type and item path an owner's muscles link to their muscle group pages under. */
export interface MuscleLinkContext {
  name: string
  field: string
}

const Row = ({ label, items }: { label: string; items: ComponentChildren[] }) =>
  items.length === 0 ? null : (
    <div class="activity-type-item-catalog-row">
      <dt>{label}</dt>
      <dd>
        {items.map((item, i) => (
          <Fragment key={i}>
            {i > 0 && ', '}
            {item}
          </Fragment>
        ))}
      </dd>
    </div>
  )

const muscleItems = (muscles: TierMuscle[], link: MuscleLinkContext | undefined) =>
  muscles.map((m) => (link ? <a href={muscleGroupHref(link.name, link.field, m.group)}>{m.name}</a> : m.name))

export const CatalogEntry = ({
  entry,
  muscleLink,
  value,
}: {
  entry: ExerciseCatalogEntry
  muscleLink?: MuscleLinkContext
  value: string
}) => {
  const { primary, secondary } = muscleTiers(entry)
  return (
    <div class="activity-type-item-catalog">
      {!isSameName(entry.name, value) && (
        <p class="activity-type-item-catalog-name">In the catalogue as {entry.name}</p>
      )}
      <dl class="activity-type-item-catalog-list">
        <Row label="Primary muscles" items={muscleItems(primary, muscleLink)} />
        <Row label="Secondary muscles" items={muscleItems(secondary, muscleLink)} />
        <Row label="Equipment" items={entry.equipment.map((e) => e.name)} />
      </dl>
    </div>
  )
}
