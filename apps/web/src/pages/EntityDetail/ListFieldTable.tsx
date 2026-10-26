import { fieldLabel } from '../../components/sessions/sessionView'
import { formatListCell, type ListTable } from './activityStats'

export const ListFieldTable = ({ table }: { table: ListTable }) => (
  <div class="list-field-detail">
    <h3>{`${table.label} (${table.rows.length})`}</h3>
    <div class="list-field-scroll">
      <table class="activity-stats-table list-field-table">
        <thead>
          <tr>
            {table.columns.map((column) => (
              <th key={column.name} scope="col">
                {fieldLabel(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i}>
              {table.columns.map((column) => (
                <td key={column.name} class={column.type === 'number' ? 'list-field-number' : undefined}>
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
