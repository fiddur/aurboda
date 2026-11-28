import type { JournalContextValue } from '@aurboda/api-spec'

/**
 * One item of the context line: label, the value with its decimals in `locale` (the browser's by default), suffix.
 * The weather's text is not its value (a condition in words, a temperature range), so it shows the server's text.
 */
export const contextToken = (item: JournalContextValue, locale?: string): string =>
  item.kind === 'weather'
    ? item.text
    : `${item.label}${item.value.toLocaleString(locale, {
        maximumFractionDigits: item.decimals,
        minimumFractionDigits: item.decimals,
        signDisplay: 'negative',
        useGrouping: false,
      })}${item.suffix}`
