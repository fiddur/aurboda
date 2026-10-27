import { fieldLabel } from '../../components/sessions/sessionView'
import { formatListCell, type ListTable } from './activityStats'

const numberClass = (column: ListTable['columns'][number]): string | undefined =>
  column.type === 'number' ? 'list-field-number' : undefined

export const ListFieldTable = ({ table }: { table: ListTable }) => (
  <div class="list-field-detail">
    <h3>{`${table.label} (${table.rows.length})`}</h3>
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
  </div>
)
