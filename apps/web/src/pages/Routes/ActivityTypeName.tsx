import { useQuery } from '@tanstack/react-query'

import { fetchActivityTypeDefinitions } from '../../state/api'
import { typeDisplayName } from './format'

export const ActivityTypeName = ({ name }: { name: string }) => {
  const { data: definitions = [] } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activityTypeDefinitions'],
    staleTime: 30 * 60_000,
  })
  return <>{typeDisplayName(name, definitions)}</>
}
