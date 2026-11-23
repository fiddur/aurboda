import type { Activity, PersonActivitiesResponse, PersonActivityTypeCount } from '@aurboda/api-spec'

import { format } from 'date-fns'

export const PERSON_ACTIVITIES_PAGE_SIZE = 50

export const activitiesHeading = (count: number, locale?: string): string =>
  count > 0 ? `Activities together (${new Intl.NumberFormat(locale).format(count)})` : 'Activities together'

export interface TypeChip {
  type: string | null
  label: string
  active: boolean
}

/** "All" and one chip per type, or none when there is a single type to choose from. */
export const typeChips = (types: PersonActivityTypeCount[], active: string | null): TypeChip[] =>
  types.length < 2
    ? []
    : [
        { active: active === null, label: 'All', type: null },
        ...types.map((t) => ({
          active: active === t.activity_type,
          label: `${t.type_name} (${t.count})`,
          type: t.activity_type,
        })),
      ]

export interface ActivityPages {
  activities: Activity[]
  hasMore: boolean
  total: number | undefined
}

export const activityPages = (pages: PersonActivitiesResponse[]): ActivityPages => ({
  activities: pages.flatMap((page) => page.data ?? []),
  hasMore: Boolean(pages.at(-1)?.next_cursor),
  total: pages.at(-1)?.total,
})

/** The row's date and time, with the year only when it is not this year's. */
export const activityWhen = (start: Date, now: Date): string =>
  format(start, start.getFullYear() === now.getFullYear() ? 'EEE d MMM, HH:mm' : 'EEE d MMM yyyy, HH:mm')
