/** The reserved breakdown field for the people an activity was with; the `@` keeps a data field named `people` a field. */
export const PEOPLE_BREAKDOWN_FIELD = '@people'

export const isPeopleBreakdownField = (field: string): boolean => field === PEOPLE_BREAKDOWN_FIELD
