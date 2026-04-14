/**
 * Default emoji icons for timeline items.
 * Activity and exercise type icons are managed via activity type definitions (/activity-types).
 *
 * Keys use a prefix convention to avoid collision with tag names.
 */
export const DEFAULT_ITEM_ICONS: Record<string, string> = {
  // Meal types
  'meal:breakfast': '🍳',
  'meal:lunch': '🍽️',
  'meal:dinner': '🍽️',
  'meal:snack': '🍿',
  'meal:drink': '☕',
  'meal:default': '🍽️',
}

/**
 * Resolve an icon for a timeline item key.
 * Checks user overrides first, then falls back to defaults.
 */
export const resolveItemIcon = (key: string, userIcons: Record<string, string>): string | undefined => {
  if (userIcons[key] !== undefined) {
    // Empty string means user explicitly cleared the icon
    return userIcons[key] || undefined
  }

  // Case-insensitive fallback for user icons (keys may differ in casing between pages)
  const lower = key.toLowerCase()
  for (const [k, v] of Object.entries(userIcons)) {
    if (k.toLowerCase() === lower) return v || undefined
  }

  if (DEFAULT_ITEM_ICONS[key]) return DEFAULT_ITEM_ICONS[key]

  // Case-insensitive fallback for defaults (exercise type names may differ in casing)
  for (const [k, v] of Object.entries(DEFAULT_ITEM_ICONS)) {
    if (k.toLowerCase() === lower) return v
  }
  return undefined
}

/**
 * Common word → emoji lookup for auto-suggesting tag icons.
 * Kept intentionally small — covers the most common life-logging tags.
 */
const WORD_TO_EMOJI: Record<string, string> = {
  alcohol: '🍺',
  allergy: '🤧',
  apple: '🍎',
  bad_sleep: '😴',
  bath: '🛁',
  bed: '🛏️',
  beer: '🍺',
  bike: '🚲',
  biking: '🚲',
  breakfast: '🍳',
  breathwork: '🌬️',
  brunch: '🍳',
  bus: '🚌',
  cafe: '☕',
  car: '🚗',
  cleaning: '🧹',
  cocktail: '🍹',
  code: '💻',
  coding: '💻',
  coffee: '☕',
  cold: '🥶',
  cooking: '🍳',
  cycling: '🚴',
  dancing: '💃',
  dentist: '🦷',
  dessert: '🍰',
  dinner: '🍽️',
  doctor: '👨‍⚕️',
  dog: '🐕',
  drink: '🥤',
  driving: '🚗',
  exercise: '🏋️',
  fatigue: '😫',
  flight: '✈️',
  flu: '🤒',
  food: '🍽️',
  fruit: '🍎',
  gaming: '🎮',
  good_sleep: '😴',
  gym: '🏋️',
  hike: '🥾',
  hiking: '🥾',
  home: '🏠',
  hot: '🥵',
  ice_cream: '🍨',
  journal: '📓',
  juice: '🧃',
  laundry: '🧺',
  lunch: '🍽️',
  meal: '🍽️',
  medicine: '💊',
  meditation: '🧘',
  meeting: '📅',
  migraine: '🤕',
  mood: '😊',
  movie: '🎬',
  music: '🎵',
  nap: '😴',
  nausea: '🤢',
  noodle: '🍜',
  office: '🏢',
  pain: '😣',
  pain_killer: '💊',
  painkiller: '💊',
  party: '🎉',
  period: '🩸',
  phone: '📱',
  pill: '💊',
  pizza: '🍕',
  podcast: '🎧',
  poop: '💩',
  rain: '🌧️',
  reading: '📖',
  rest: '😌',
  restaurant: '🍽️',
  rice: '🍚',
  run: '🏃',
  running: '🏃',
  sauna: '🧖',
  shower: '🚿',
  sick: '🤒',
  sleep: '😴',
  smoking: '🚬',
  snack: '🍿',
  snow: '❄️',
  social: '👥',
  soda: '🥤',
  soup: '🍲',
  sport: '⚽',
  steps: '👣',
  stomach: '🤢',
  stress: '😰',
  stretching: '🧘',
  study: '📚',
  sugar: '🍬',
  sun: '☀️',
  supplement: '💊',
  sushi: '🍣',
  swim: '🏊',
  swimming: '🏊',
  tea: '🍵',
  teeth: '🦷',
  tired: '😫',
  train: '🚆',
  travel: '✈️',
  vitamins: '💊',
  walk: '🚶',
  walking: '🚶',
  water: '💧',
  weather: '🌤️',
  weight: '⚖️',
  wine: '🍷',
  work: '💼',
  workout: '🏋️',
  writing: '✍️',
  yoga: '🧘',
}

/**
 * Look up a suggested emoji for a tag name.
 * Tries exact match first, then lowercased, then individual words.
 * Returns undefined if no match found.
 */
export const suggestEmoji = (tagName: string): string | undefined => {
  const lower = tagName.toLowerCase().trim()

  // Exact match
  if (WORD_TO_EMOJI[lower]) return WORD_TO_EMOJI[lower]

  // Try with underscores replaced by nothing
  const noUnderscores = lower.replaceAll('_', '')
  if (WORD_TO_EMOJI[noUnderscores]) return WORD_TO_EMOJI[noUnderscores]

  // Try each word individually
  const words = lower.split(/[\s_-]+/)
  for (const word of words) {
    if (WORD_TO_EMOJI[word]) return WORD_TO_EMOJI[word]
  }

  return undefined
}

/**
 * Check if a string is a single emoji character (or emoji sequence).
 */
export const isEmoji = (str: string): boolean => {
  // Match emoji sequences including ZWJ sequences and skin tone modifiers.
  // An "emoji atom" is an emoji character optionally followed by a skin tone modifier.
  // ZWJ (\u200D) joins atoms into compound glyphs like 👨🏻‍💻 (man technologist: light skin tone).
  const emojiAtom = String.raw`(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)\p{Emoji_Modifier}?`
  const emojiRegex = new RegExp(`^${emojiAtom}(?:\\u200D${emojiAtom})*$`, 'u')
  return emojiRegex.test(str.trim())
}

/**
 * Check if a string looks like a URL (for custom icon images).
 */
export const isUrl = (str: string): boolean => {
  try {
    const url = new URL(str)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Check if a string is a path to an uploaded icon.
 */
export const isIconPath = (str: string): boolean => str.startsWith('/api/icons/')
