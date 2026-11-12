import type { CentralDb } from './central-db.ts'

export interface SupportContacts {
  contact_fediverse: string
  contact_reddit: string
}

/** The admin's contacts as stored; empty strings when unset. */
export const readSupportContacts = async (
  centralDb: Pick<CentralDb, 'getServerSetting'>,
): Promise<SupportContacts> => {
  const [fediverse, reddit] = await Promise.all([
    centralDb.getServerSetting('contact_fediverse'),
    centralDb.getServerSetting('contact_reddit'),
  ])
  return { contact_fediverse: fediverse ?? '', contact_reddit: reddit ?? '' }
}
