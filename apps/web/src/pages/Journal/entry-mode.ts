export type EntryMode = 'read' | 'edit'

export const initialEntryMode = (p: { isNew: boolean; content: string }): EntryMode =>
  p.isNew || p.content.trim() === '' ? 'edit' : 'read'
