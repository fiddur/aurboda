import { fieldLabel } from '../../components/sessions/sessionView'
import { formatListCell, type ListTable } from './activityStats'

const numberClass = (column: ListTable['columns'][number]): string | undefined =>
  column.type === 'number' ? 'list-field-number' : undefined

const Table = ({ table }: { table: ListTable }) => (
  <div class="list-field-scroll">
    <table class="activity-stats-table list-field-table">
      <thead>
        <tr>
          {table.columns.map((column) => (
            <th key={column.name} scope="col" class={numberClass(column)}>
              {fieldLabel(column)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, i) => (
          <tr key={i}>
            {table.columns.map((column) => (
              <td key={column.name} class={numberClass(column)}>
                {formatListCell(row[column.name], column.unit)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

/** A list field's items as a table; `collapsed` puts it closed under its heading, for a list summarised above it. */
export const ListFieldTable = ({ table, collapsed = false }: { table: ListTable; collapsed?: boolean }) => {
  const heading = <h3>{`${table.label} (${table.rows.length})`}</h3>
  return collapsed ? (
    <details class="list-field-detail">
      <summary>{heading}</summary>
      <Table table={table} />
    </details>
  ) : (
    <div class="list-field-detail">
      {heading}
      <Table table={table} />
    </div>
  )
}
