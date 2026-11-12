import { useEffect } from 'preact/hooks'

import { GITHUB } from '../pages/Help/help-links'
import { contactFediverse, contactReddit, ensureStatusLoaded } from '../state/auth'
import { type AdminContactLinks, adminContactLinks, type ContactLink, hasAdminContact } from './admin-contact'

export const useAdminContactLinks = (): AdminContactLinks => {
  useEffect(() => {
    ensureStatusLoaded()
  }, [])
  return adminContactLinks(contactFediverse.value, contactReddit.value, window.location.host)
}

const ContactAnchor = ({ link }: { link: ContactLink }) =>
  link.href.startsWith('/') ? (
    <a href={link.href}>
      <strong>{link.label}</strong>
    </a>
  ) : (
    <a href={link.href} target="_blank" rel="noopener noreferrer">
      <strong>{link.label}</strong>
    </a>
  )

/** How to reach the person who runs this server; nothing when the admin has set no contact. */
export function AdminContact() {
  const { fediverse, reddit } = useAdminContactLinks()
  if (!fediverse && !reddit) return null
  const redditPart = reddit && (
    <>
      send a private message on Reddit to <ContactAnchor link={reddit} />
    </>
  )
  return (
    <p>
      Reach the person who runs this server{' '}
      {fediverse ? (
        <>
          on the fediverse at <ContactAnchor link={fediverse} /> (mention or message it from Mastodon or any
          other fediverse app){redditPart ? <>, or {redditPart}</> : null}.
        </>
      ) : (
        <>by sending a private message on Reddit to {reddit && <ContactAnchor link={reddit} />}.</>
      )}
    </p>
  )
}

const githubProject = (
  <a href={GITHUB} target="_blank" rel="noopener noreferrer">
    Aurboda project on GitHub
  </a>
)

/** The Contact section of the Privacy Policy and Terms of Service. */
export function StaticPageContact({ about }: { about: string }) {
  const links = useAdminContactLinks()
  return (
    <section>
      <h2>Contact</h2>
      {hasAdminContact(links) ? (
        <>
          <p>For questions about {about}, contact the administrator of this server.</p>
          <AdminContact />
          <p>Questions about the software itself can also go to the {githubProject}.</p>
        </>
      ) : (
        <p>
          For questions about {about}, contact the administrator of this server, or the {githubProject}.
        </p>
      )}
    </section>
  )
}
