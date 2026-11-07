import type { NamedLocation } from '@aurboda/api-spec'

import { describeNamedPlace, sortNamedPlaces } from './namedPlaces'

interface NamedPlacesSectionProps {
  locations: readonly NamedLocation[]
  deleting: boolean
  onEdit: (location: NamedLocation) => void
  onDelete: (location: NamedLocation) => void
}

export const NamedPlacesSection = ({ locations, deleting, onEdit, onDelete }: NamedPlacesSectionProps) => (
  <section class="named-places">
    <h2>Named places</h2>
    {locations.length === 0 ? (
      <div class="named-places-empty">No named places yet. Click a visited place to name it.</div>
    ) : (
      <ul>
        {sortNamedPlaces(locations).map((location) => (
          <li key={location.id} class="named-place-row">
            <button type="button" class="named-place-main" onClick={() => onEdit(location)}>
              <span class="named-place-name">{location.name}</span>
              <span class="named-place-meta">{describeNamedPlace(location)}</span>
            </button>
            <button
              type="button"
              class="named-place-delete"
              disabled={deleting}
              onClick={() => onDelete(location)}
              aria-label={`Delete ${location.name}`}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    )}
  </section>
)
