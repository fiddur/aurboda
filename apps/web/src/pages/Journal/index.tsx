import { useLocation, useRoute } from 'preact-iso'

import { EntryEditor } from './EntryEditor'
import { JournalList } from './JournalList'
import { JournalTags } from './JournalTags'
import './style.css'

/** `/journal` lists the entries, `/journal/tags` the tags; `/journal/new` and `/journal/<id>` open the editor. */
export function Journal() {
  const { params } = useRoute()
  const { query } = useLocation()
  if (!params.id) return <JournalList />
  if (params.id === 'tags') return <JournalTags />
  if (params.id === 'new') return <EntryEditor key="new" templateId={query.template} />
  return <EntryEditor key={params.id} id={params.id} />
}
