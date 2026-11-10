import { Fragment } from 'preact'
import { useEffect } from 'preact/hooks'

import { publicTagPath } from '../state/api/blogUrls'
import { ensureStatusLoaded, publicTagPages } from '../state/auth'

/** "See what people share with #a and #b", linking each public tag page; nothing when there are none. */
export function PublicTagLinks({ class: className }: { class?: string }) {
  useEffect(() => {
    ensureStatusLoaded()
  }, [])
  const tags = publicTagPages.value
  if (tags.length === 0) return null
  return (
    <p class={className}>
      See what people share with{' '}
      {tags.map((tag, i) => (
        <Fragment key={tag}>
          {i > 0 && (i === tags.length - 1 ? ' and ' : ', ')}
          <a href={publicTagPath(tag)}>#{tag}</a>
        </Fragment>
      ))}
    </p>
  )
}
