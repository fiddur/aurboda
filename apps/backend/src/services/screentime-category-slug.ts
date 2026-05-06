/**
 * Slug generation for screentime category → activity_type_definitions linking.
 *
 * Slugs are derived from the category leaf name (`["Work", "TV"]` → `tv`) so a
 * category and a same-named deduction-rule activity type converge on a single
 * type. Only when the bare leaf collides with an unrelated builtin type does
 * the slug get prefixed with the parent slug (`work_tv`); a final numeric
 * suffix is appended if even that is taken.
 *
 * Slugs are saved on the category row at first sync and never recomputed —
 * renames and moves leave the slug stable so existing activities of that type
 * keep their classification across category edits.
 */

const MAX_LEN = 100

const slugify = (s: string): string =>
  s
    .replaceAll(/[[\]()]/g, '')
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_|_$/g, '')
    .replaceAll(/_+/g, '_') || 'unknown'

const ensureLeadingLetter = (s: string): string => (/^[a-z]/.test(s) ? s : `t_${s}`)

const truncate = (s: string): string => (s.length <= MAX_LEN ? s : s.slice(0, MAX_LEN))

interface SlugOptions {
  /** Slugs that already exist as non-builtin activity types — convergence target. */
  existingNonBuiltin: ReadonlySet<string>
  /** Slugs that already exist as builtin activity types — must NOT be reused. */
  existingBuiltin: ReadonlySet<string>
}

export interface GenerateSlugResult {
  slug: string
  /** True when an existing non-builtin type with that slug already exists; the caller links to it instead of inserting. */
  linkToExisting: boolean
}

/**
 * Pick a slug for a category whose leaf is `leafName` and whose immediate
 * parent (in the category hierarchy) has slug `parentSlug` (or null for
 * top-level).
 *
 * Convergence rule: a non-builtin type with the same name is *reused*, not
 * renamed. This is what makes a `tv` deduction rule and a `tv` category
 * collapse into one type. Only builtin collisions (the umbrella `screentime`,
 * `exercise`, etc.) force a rename.
 */
export const generateSlug = (
  leafName: string,
  parentSlug: string | null,
  opts: SlugOptions,
): GenerateSlugResult => {
  const base = ensureLeadingLetter(slugify(leafName))

  if (opts.existingNonBuiltin.has(base)) {
    return { slug: truncate(base), linkToExisting: true }
  }
  if (!opts.existingBuiltin.has(base)) {
    return { slug: truncate(base), linkToExisting: false }
  }

  // Builtin collision — try parent-prefixed form.
  if (parentSlug) {
    const prefixed = ensureLeadingLetter(`${parentSlug}_${base}`)
    if (opts.existingNonBuiltin.has(prefixed)) {
      return { slug: truncate(prefixed), linkToExisting: true }
    }
    if (!opts.existingBuiltin.has(prefixed)) {
      return { slug: truncate(prefixed), linkToExisting: false }
    }
  }

  // Final fallback: numeric suffix until free. Unlikely in practice.
  for (let i = 2; i < 1000; i++) {
    const candidate = ensureLeadingLetter(`${base}_${i}`)
    if (opts.existingNonBuiltin.has(candidate)) {
      return { slug: truncate(candidate), linkToExisting: true }
    }
    if (!opts.existingBuiltin.has(candidate)) {
      return { slug: truncate(candidate), linkToExisting: false }
    }
  }
  throw new Error(`Could not generate slug for "${leafName}" — exhausted suffixes`)
}
