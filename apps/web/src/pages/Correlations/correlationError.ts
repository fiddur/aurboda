const UNKNOWN_PEOPLE_PREFIX = 'Unknown people: '

export const correlationErrorText = (message: string): string =>
  message.startsWith(UNKNOWN_PEOPLE_PREFIX) ? 'This analysis uses a person no longer listed.' : message
