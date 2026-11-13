import type { ExerciseCatalogEntry } from '@aurboda/api-spec'

import { isSameName } from '../../components/knownValueSuggestions'
import { muscleTiers } from './catalogEntryView'

const Row = ({ label, items }: { label: string; items: string[] }) =>
  items.length === 0 ? null : (
    <div class="activity-type-item-catalog-row">
      <dt>{label}</dt>
      <dd>{items.join(', ')}</dd>
    </div>
  )

export const CatalogEntry = ({ entry, value }: { entry: ExerciseCatalogEntry; value: string }) => {
  const { primary, secondary } = muscleTiers(entry)
  return (
    <div class="activity-type-item-catalog">
      {!isSameName(entry.name, value) && (
        <p class="activity-type-item-catalog-name">In the catalogue as {entry.name}</p>
      )}
      <dl class="activity-type-item-catalog-list">
        <Row label="Primary muscles" items={primary} />
        <Row label="Secondary muscles" items={secondary} />
        <Row label="Equipment" items={entry.equipment.map((e) => e.name)} />
      </dl>
    </div>
  )
}
