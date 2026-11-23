import { useQuery } from '@tanstack/react-query'

import { categoricalItemFields, itemPath } from '../../components/sessions/sessionView'
import { fetchActivityTypeDefinitions } from '../../state/api'
import { SETS_PATH, STRENGTH_TYPE } from './constants'
import { ExerciseList } from './ExerciseList'
import { StrengthHeader } from './StrengthHeader'
import '../ActivityTypeMeta/style.css'
import './style.css'

export function StrengthExercises() {
  const {
    data: definitions,
    isError,
    isLoading,
  } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activityTypeDefinitions'],
    staleTime: 5 * 60 * 1000,
  })
  const typeDef = definitions?.find((d) => d.name === STRENGTH_TYPE)
  const field = categoricalItemFields(typeDef?.data_schema).find(
    ({ list, item }) => itemPath(list, item) === SETS_PATH,
  )

  return (
    <div class="page page--wide strength-page strength-page-wide">
      <StrengthHeader />
      {isLoading && <p class="loading">Loading...</p>}
      {isError && <p class="strength-error">Your activity types could not be loaded.</p>}
      {!isLoading && !isError && !field && (
        <p>
          No strength sessions yet. <a href="/strength/workouts">Start or log one</a>
        </p>
      )}
      {field && <ExerciseList list={field.list} item={field.item} />}
    </div>
  )
}
