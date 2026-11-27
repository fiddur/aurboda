import type { JournalContextValue } from '@aurboda/api-spec'

/** One item of the context line: label, the value with its decimals in `locale` (the browser's by default), suffix. */
export const contextToken = (item: JournalContextValue, locale?: string): string =>
  `${item.label}${item.value.toLocaleString(locale, {
    maximumFractionDigits: item.decimals,
    minimumFractionDigits: item.decimals,
    signDisplay: 'negative',
    useGrouping: false,
  })}${item.suffix}`
