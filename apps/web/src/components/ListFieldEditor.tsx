import type { DataItemFieldDefinition } from '@aurboda/api-spec'

import { addRowLabel, type ListRow, moveRow, newRow, removeRow, setCell } from './listFieldRows'
import { fieldLabel, type ListFieldDefinition } from './sessions/sessionView'
import './ListFieldEditor.css'

const columnHeader = (item: DataItemFieldDefinition) =>
  item.unit ? `${fieldLabel(item)} (${item.unit})` : fieldLabel(item)

const CellInput = ({
  id,
  item,
  label,
  value,
  onChange,
}: {
  id: string
  item: DataItemFieldDefinition
  label: string
  value: unknown
  onChange: (value: unknown) => void
}) => {
  if (item.type === 'boolean') {
    return (
      <input
        id={id}
        type="checkbox"
        aria-label={label}
        checked={value === true}
        onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
      />
    )
  }

  if (item.type === 'string' && item.enum_values) {
    return (
      <select
        id={id}
        class="list-field-editor-input"
        aria-label={label}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange((e.target as HTMLSelectElement).value || null)}
      >
        <option value="">--</option>
        {item.enum_values.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    )
  }

  if (item.type === 'number') {
    return (
      <input
        id={id}
        type="number"
        step="any"
        inputMode="decimal"
        class="list-field-editor-input list-field-editor-number"
        aria-label={label}
        value={value != null ? String(value) : ''}
        onInput={(e) => {
          const raw = (e.target as HTMLInputElement).value
          if (raw === '') {
            onChange(null)
          } else {
            const num = parseFloat(raw)
            if (!isNaN(num)) onChange(num)
          }
        }}
      />
    )
  }

  return (
    <input
      id={id}
      type="text"
      class="list-field-editor-input"
      aria-label={label}
      autoComplete="off"
      value={value != null ? String(value) : ''}
      onInput={(e) => onChange((e.target as HTMLInputElement).value || null)}
    />
  )
}

/** Rows of a list field (the sets of a strength session) edited in place; undeclared keys are kept. */
export const ListFieldEditor = ({
  field,
  rows,
  onChange,
  idPrefix = `list-${field.name}`,
}: {
  field: ListFieldDefinition
  rows: ListRow[]
  onChange: (rows: ListRow[]) => void
  idPrefix?: string
}) => {
  const items = field.item_fields
  return (
    <div class="list-field-editor">
      {rows.length > 0 && (
        <div class="list-field-editor-scroll">
          <table class="list-field-editor-table">
            <thead>
              <tr>
                <th class="list-field-editor-index">#</th>
                {items.map((item) => (
                  <th key={item.name}>{columnHeader(item)}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td class="list-field-editor-index">{i + 1}</td>
                  {items.map((item) => (
                    <td key={item.name}>
                      <CellInput
                        id={`${idPrefix}-${i}-${item.name}`}
                        item={item}
                        label={`${fieldLabel(item)}, row ${i + 1}`}
                        value={row[item.name]}
                        onChange={(value) => onChange(setCell(rows, i, item.name, value))}
                      />
                    </td>
                  ))}
                  <td class="list-field-editor-actions">
                    <button
                      type="button"
                      class="list-field-editor-button"
                      title="Move up"
                      aria-label={`Move row ${i + 1} up`}
                      disabled={i === 0}
                      onClick={() => onChange(moveRow(rows, i, -1))}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      class="list-field-editor-button"
                      title="Move down"
                      aria-label={`Move row ${i + 1} down`}
                      disabled={i === rows.length - 1}
                      onClick={() => onChange(moveRow(rows, i, 1))}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      class="list-field-editor-button list-field-editor-remove"
                      title="Remove"
                      aria-label={`Remove row ${i + 1}`}
                      onClick={() => onChange(removeRow(rows, i))}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button
        type="button"
        class="list-field-editor-add"
        onClick={() => onChange([...rows, newRow(rows.at(-1), items)])}
      >
        {addRowLabel(fieldLabel(field))}
      </button>
    </div>
  )
}
