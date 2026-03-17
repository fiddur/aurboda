/**
 * Default emoji icons for activity types and exercise types on the timeline.
 * These are applied automatically unless the user overrides them in item_icons settings.
 *
 * Keys use a prefix convention to avoid collision with tag names:
 * - Activity types: 'activity:sleep', 'activity:nap', 'activity:meditation'
 * - Exercise types: 'exercise:Running', 'exercise:Biking', etc. (matching exerciseTypeNames display labels)
 */
export const DEFAULT_ITEM_ICONS: Record<string, string> = {
  // Activity types
  'activity:meditation': '🧘',
  'activity:nap': '💤',
  'activity:rest': '😌',
  'activity:sleep': '😴',

  // Exercise types (keyed by display name from exerciseTypeNames)
  'exercise:Biking': '🚴',
  'exercise:Boot Camp': '🏋️',
  'exercise:Calisthenics': '🤸',
  'exercise:Dancing': '💃',
  'exercise:Elliptical': '🏃',
  'exercise:HIIT': '🔥',
  'exercise:Hiking': '🥾',
  'exercise:Ice Skating': '⛸️',
  'exercise:Pilates': '🧘',
  'exercise:Rock Climbing': '🧗',
  'exercise:Rowing': '🚣',
  'exercise:Running': '🏃',
  'exercise:Soccer': '⚽',
  'exercise:Stair Climbing': '🪜',
  'exercise:Strength Training': '💪',
  'exercise:Stretching': '🧘',
  'exercise:Swimming (Open Water)': '🏊',
  'exercise:Swimming (Pool)': '🏊',
  'exercise:Treadmill': '🏃',
  'exercise:Walking': '🚶',
  'exercise:Weightlifting': '🏋️',
  'exercise:Workout': '🏋️',
  'exercise:Yoga': '🧘',
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
  return DEFAULT_ITEM_ICONS[key]
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
  // Match emoji sequences including ZWJ sequences, skin tone modifiers, etc.
  const emojiRegex =
    /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(\u200D(\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*$/u
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
