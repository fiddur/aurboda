import { useRoute } from 'preact-iso'

import { PeopleList } from './PeopleList'
import { PersonPage } from './PersonPage'
import './style.css'

export function People() {
  const { params } = useRoute()
  return params.id ? <PersonPage key={params.id} id={params.id} /> : <PeopleList />
}
