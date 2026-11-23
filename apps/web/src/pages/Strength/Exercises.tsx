import { useQuery } from '@tanstack/react-query'

import { categoricalItemFields, itemPath } from '../../components/sessions/sessionView'
import { fetchActivityTypeDefinitions } from '../../state/api'
import { ItemGroupsSection } from '../ActivityTypeMeta/ItemGroupsSection'
import { SETS_PATH, STRENGTH_TYPE } from './constants'
import { StrengthTabs } from './StrengthTabs'
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
      <h1>Strength</h1>
      <StrengthTabs />
      {isLoading && <p class="loading">Loading...</p>}
      {isError && <p class="strength-error">Your activity types could not be loaded.</p>}
      {!isLoading && !isError && !field && (
        <p>
          No strength sessions yet. <a href="/strength">Start or log one</a>
        </p>
      )}
      {field && (
        <ItemGroupsSection
          name={STRENGTH_TYPE}
          path={SETS_PATH}
          list={field.list}
          item={field.item}
          heading="Your exercises"
        />
      )}
    </div>
  )
}
