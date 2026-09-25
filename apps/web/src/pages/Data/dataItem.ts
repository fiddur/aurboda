export type ItemType = 'activity' | 'location' | 'media' | 'meal' | 'metric' | 'report' | 'screentime'

export interface DataItem {
  color: string
  detail: string
  end?: Date
  href?: string
  label: string
  start: Date
  type: ItemType
}
