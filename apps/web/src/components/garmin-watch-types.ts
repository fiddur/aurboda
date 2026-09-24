import {
  defaultGarminSportForType,
  type GarminSport,
  garminSportLabel,
  garminSports,
  type GarminWatchType,
  garminWatchSessionNameMaxLength,
} from '@aurboda/api-spec'

export const nextWatchTypeCode = (types: GarminWatchType[]): number =>
  types.reduce((max, t) => Math.max(max, t.code), 0) + 1

export const toSessionName = (name: string): string => name.trim().slice(0, garminWatchSessionNameMaxLength)

export const addWatchType = (
  types: GarminWatchType[],
  activityType: string,
  displayName: string,
): GarminWatchType[] => {
  if (!activityType || types.some((t) => t.activity_type === activityType)) return types
  const { sport, sub_sport } = defaultGarminSportForType(activityType)
  return [
    ...types,
    {
      activity_type: activityType,
      code: nextWatchTypeCode(types),
      fit_sport: sport,
      fit_sub_sport: sub_sport,
      session_name: toSessionName(displayName) || toSessionName(activityType),
    },
  ]
}

export const removeWatchType = (types: GarminWatchType[], activityType: string): GarminWatchType[] =>
  types.filter((t) => t.activity_type !== activityType)

export const moveWatchType = (
  types: GarminWatchType[],
  activityType: string,
  offset: number,
): GarminWatchType[] => {
  const from = types.findIndex((t) => t.activity_type === activityType)
  const to = from + offset
  if (from < 0 || to < 0 || to >= types.length) return types
  const next = [...types]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

export const renameWatchType = (
  types: GarminWatchType[],
  activityType: string,
  name: string,
): GarminWatchType[] => {
  const sessionName = toSessionName(name)
  if (!sessionName) return types
  return types.map((t) => (t.activity_type === activityType ? { ...t, session_name: sessionName } : t))
}

export const setWatchTypeSport = (
  types: GarminWatchType[],
  activityType: string,
  sport: number,
  subSport: number,
): GarminWatchType[] =>
  types.map((t) =>
    t.activity_type === activityType ? { ...t, fit_sport: sport, fit_sub_sport: subSport } : t,
  )

export const sportOptionValue = (sport: number, subSport: number): string => `${sport}/${subSport}`

export const parseSportOptionValue = (value: string): { sport: number; sub_sport: number } | undefined => {
  const match = /^(\d+)\/(\d+)$/.exec(value)
  return match ? { sport: Number(match[1]), sub_sport: Number(match[2]) } : undefined
}

export const sportOptionsFor = (sport: number, subSport: number): GarminSport[] =>
  garminSports.some((s) => s.sport === sport && s.sub_sport === subSport)
    ? garminSports
    : [...garminSports, { label: garminSportLabel(sport, subSport), sport, sub_sport: subSport }]
