const UNDECOMPOSED: Record<string, string> = {
  æ: 'ae',
  ð: 'd',
  đ: 'd',
  ı: 'i',
  ł: 'l',
  ø: 'o',
  œ: 'oe',
  ß: 'ss',
  þ: 'th',
}

/** Text folded for matching what was typed: lowercase, accents and other marks dropped, so `the` finds `Thérèse`. */
export const searchFold = (text: string): string =>
  text
    .normalize('NFD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll(/[æðđıłøœßþ]/g, (c) => UNDECOMPOSED[c] ?? c)

/** Whether `text` holds the already folded `needle`. */
export const foldedIncludes = (text: string | null | undefined, needle: string): boolean =>
  text != null && searchFold(text).includes(needle)

/** Whether `text` starts with the already folded `needle`. */
export const foldedStartsWith = (text: string, needle: string): boolean => searchFold(text).startsWith(needle)
