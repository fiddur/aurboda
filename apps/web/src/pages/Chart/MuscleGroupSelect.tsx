import { exerciseMuscleGroups, exerciseMuscleInfo } from '@aurboda/api-spec'

/** All muscle groups, or one, by display name; an empty value is All. */
export const MuscleGroupSelect = ({
  onChange,
  value,
}: {
  onChange: (group: string) => void
  value: string
}) => (
  <label>
    Muscle group
    <select value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
      <option value="">All</option>
      {exerciseMuscleGroups.map((group) => (
        <option key={group} value={group}>
          {exerciseMuscleInfo[group].name}
        </option>
      ))}
    </select>
  </label>
)
