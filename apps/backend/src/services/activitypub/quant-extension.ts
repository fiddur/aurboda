/**
 * QuantPub (`quant:`) JSON-LD extension for federated exercise shares (#896).
 *
 * Implements the vocabulary from `docs/fep/quantpub.md` on the wire: a shared
 * activity's Note is dual-typed `["Note", "quant:Exercise"]` and carries the
 * typed extension properties (`quant:activityType`, `quant:metrics`,
 * `quant:series`, `quant:structuredUrl`) so a QuantPub peer reads structured
 * data in-band while Mastodon still renders the plain Note. The AS2 window
 * (`startTime`/`endTime`) is set natively on the Fedify `Note` (the FEP reuses
 * AS2's own terms), so only the `quant:` terms need this module.
 *
 * Fedify's generated vocabulary drops unknown properties, so the extension is
 * spliced into the **serialized JSON-LD** instead: `withQuantJsonLd` wraps one
 * locally-built instance's `toJsonLd` and post-processes its final document —
 * after all of Fedify's own JSON-LD compaction — adding the properties, the
 * dual type, and the inline `@context` term definitions (`quant:metrics` and
 * `quant:series` are `@json` literals per FEP §1, so JSON-LD processors keep
 * their nested objects verbatim). Wrap only the OUTERMOST object handed to
 * Fedify (the bare `Note` for the object dispatcher; the `Create`/`Update` for
 * delivery and the outbox): an embedded child's splice would be re-compacted
 * against the parent's context and mangled into expanded-IRI form.
 *
 * Caveat: the wrapper is an instance patch, so anything that CLONES the object
 * afterwards (e.g. Fedify's Ed25519 `signObject`, unused here — Aurboda only
 * provisions RSA keys) would silently drop the extension. The RSA Linked-Data
 * signature and HTTP signatures both operate on the spliced document, so they
 * stay valid.
 */
import type { FeedVisibility } from '@aurboda/api-spec'
import type { Object as APObject } from '@fedify/fedify/vocab'

import type { ScalarMetric } from './object.ts'

import { isPubliclyVisible } from './object.ts'

/** The QuantPub JSON-LD namespace (FEP §1; final IRI settles with the FEP number). */
export const QUANT_NS = 'https://w3id.org/quantpub#'

/** The QuantPub spec version this implementation speaks (discovery document §4). */
export const QUANTPUB_VERSION = '0.1'

/**
 * The inline `@context` entry defining the `quant:` prefix. `quant:metrics` and
 * `quant:series` are JSON literals (`@json`) so conforming processors preserve
 * their nested `key`/`value`/`unit` and `metric`/`mediaType`/`href` objects
 * verbatim instead of expanding (and losing) unmapped keys.
 */
export const quantContextEntry: Record<string, unknown> = {
  quant: QUANT_NS,
  'quant:metrics': { '@type': '@json' },
  'quant:series': { '@type': '@json' },
}

/**
 * The published JSON-LD `@context` document (served at `/ns/quantpub`), the
 * canonical form of the inline entry every delivered object also embeds.
 */
export const quantContextDocument: Record<string, unknown> = { '@context': quantContextEntry }

export interface QuantExerciseInput {
  /** Public API base, e.g. `https://aurboda.net/api` (structured + series URLs hang off it). */
  apiBaseUrl: string
  user: string
  postId: string
  /** Capability token appended for `followers`-only posts (FEP §9). */
  imageToken: string
  visibility: FeedVisibility
  activityType: string
  startTime: Date
  endTime?: Date
  /** Resolved scalar summaries for the shared `included_metrics`. */
  scalars: ScalarMetric[]
  /** Metric keys whose series were explicitly shared (drive `quant:series`). */
  seriesMetrics: string[]
  /** Bucket granularity for the series links (defaults to `5s`). */
  seriesBucket?: string
}

/**
 * Build the `quant:` extension properties for one shared activity (FEP §2).
 *
 * `quant:series` links are emitted only for `public`/`unlisted` posts with a
 * bounded window: the public series endpoint refuses `followers`-only posts,
 * so advertising links there would just 404. `quant:structuredUrl` carries the
 * capability token for `followers`-only posts (FEP §9 allows it — the token is
 * already in the delivered image attachment URLs, never on a public surface).
 */
export const quantExerciseExtension = (input: QuantExerciseInput): Record<string, unknown> => {
  const publicBase = `${input.apiBaseUrl.replace(/\/+$/, '')}/public/${encodeURIComponent(input.user)}`
  const token = isPubliclyVisible(input.visibility) ? '' : `?token=${encodeURIComponent(input.imageToken)}`
  const props: Record<string, unknown> = {
    'quant:activityType': input.activityType,
    'quant:metrics': input.scalars.map(({ key, unit, value }) => ({
      key,
      ...(unit === undefined ? {} : { unit }),
      value,
    })),
    'quant:structuredUrl': `${publicBase}/feed/${input.postId}${token}`,
  }
  const endTime = input.endTime
  if (isPubliclyVisible(input.visibility) && endTime !== undefined && input.seriesMetrics.length > 0) {
    const bucket = input.seriesBucket ?? '5s'
    props['quant:series'] = input.seriesMetrics.map((metric) => {
      const params = new URLSearchParams({
        bucket,
        end: endTime.toISOString(),
        metric,
        start: input.startTime.toISOString(),
      })
      return { href: `${publicBase}/series?${params.toString()}`, mediaType: 'application/json', metric }
    })
  }
  return props
}

type JsonRecord = Record<string, unknown>

const isRecord = (v: unknown): v is JsonRecord => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Dual-type a serialized `type` value with `quant:Exercise` (idempotent). */
const withQuantType = (type: unknown): unknown => {
  if (typeof type === 'string') return type === 'quant:Exercise' ? type : [type, 'quant:Exercise']
  if (Array.isArray(type)) return type.includes('quant:Exercise') ? type : [...type, 'quant:Exercise']
  return type
}

/** Append the `quant:` term definitions to a serialized `@context` value. */
const withQuantContext = (context: unknown): unknown => {
  if (context === undefined || context === null) {
    return ['https://www.w3.org/ns/activitystreams', quantContextEntry]
  }
  return Array.isArray(context) ? [...context, quantContextEntry] : [context, quantContextEntry]
}

/**
 * Splice the extension into a final serialized document: onto the embedded
 * `object` when the document is an activity (`Create`/`Update`), else onto the
 * document itself, extending each `@context` in scope. Non-object documents
 * pass through untouched — enrichment must never break serialization.
 */
export const spliceQuantExtension = (doc: unknown, props: JsonRecord): unknown => {
  if (!isRecord(doc)) return doc
  const embedded = isRecord(doc.object) ? doc.object : undefined
  const target = embedded ?? doc
  const enriched: JsonRecord = { ...target, ...props, type: withQuantType(target.type) }
  // An embedded object serialized with its own scoped @context keeps it valid standalone.
  if (embedded !== undefined && '@context' in enriched) {
    enriched['@context'] = withQuantContext(enriched['@context'])
  }
  const out: JsonRecord = embedded === undefined ? enriched : { ...doc, object: enriched }
  return { ...out, '@context': withQuantContext(out['@context']) }
}

/**
 * Wrap a locally-built Fedify object so its serialized JSON-LD carries the
 * `quant:` extension. Returns the same instance, with `toJsonLd` patched to
 * post-process its own output.
 */
export const withQuantJsonLd = <T extends APObject>(obj: T, props: JsonRecord): T => {
  const base = obj.toJsonLd.bind(obj)
  obj.toJsonLd = async (options?: Parameters<APObject['toJsonLd']>[0]): Promise<unknown> =>
    spliceQuantExtension(await base(options), props)
  return obj
}
