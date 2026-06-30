import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios'
/**
 * Guarded outbound HTTP for federation (SSRF protection).
 *
 * Federation endpoints fetch URLs supplied by (partly untrusted) other
 * instances, some reachable via unauthenticated routes. Before fetching we
 * resolve the host and refuse private/loopback/link-local/reserved targets, and
 * we disable redirect-following so a 3xx can't bounce the request to an internal
 * address. This does not defend against DNS rebinding (TOCTOU) — acceptable for
 * v1; signed instance-to-instance requests are the longer-term hardening.
 */
import dns from 'node:dns/promises'
import net from 'node:net'

const DEFAULT_TIMEOUT_MS = 8000

const ipv4ToOctets = (ip: string): number[] => ip.split('.').map((p) => Number.parseInt(p, 10))

/** Private / loopback / link-local / reserved IPv4 ranges. */
// eslint-disable-next-line complexity -- a flat list of IPv4 range checks
const isBlockedIPv4 = (ip: string): boolean => {
  const [a, b] = ipv4ToOctets(ip)
  if (a === 0 || a === 10 || a === 127) return true // this-network, private, loopback
  if (a === 169 && b === 254) return true // link-local (incl. cloud metadata 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 168) return true // private
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a === 192 && b === 0) return true // 192.0.0.0/24 + 192.0.2.0/24 (reserved/test)
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a >= 224) return true // multicast + reserved + 255.255.255.255
  return false
}

const isBlockedIPv6 = (raw: string): boolean => {
  const ip = raw.toLowerCase()
  // Block all IPv4-mapped addresses (::ffff:… in dotted or compressed-hex form).
  // Real hosts resolve to plain v4/v6; a literal mapped address is an edge/attack.
  if (ip.startsWith('::ffff:')) return true
  if (ip === '::1' || ip === '::') return true // loopback / unspecified
  if (ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb'))
    {return true} // fe80::/10 link-local
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true // fc00::/7 unique-local
  return false
}

const isBlockedAddress = (ip: string): boolean => {
  if (net.isIPv4(ip)) return isBlockedIPv4(ip)
  if (net.isIPv6(ip)) return isBlockedIPv6(ip)
  return true // unknown form → block
}

/** Throw unless `rawUrl` is an http(s) URL whose host resolves only to public addresses. */
export const assertPublicUrl = async (rawUrl: string): Promise<void> => {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('Invalid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed')
  }

  const host = url.hostname.replaceAll(/^\[|\]$/g, '') // strip IPv6 brackets
  const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address)
  if (addresses.length === 0) throw new Error('Host did not resolve')
  for (const address of addresses) {
    if (isBlockedAddress(address)) {
      throw new Error(`Refusing to fetch a private/loopback/reserved address (${address})`)
    }
  }
}

const guardedConfig = (config?: AxiosRequestConfig): AxiosRequestConfig => ({
  maxRedirects: 0, // a redirect could bounce to an internal address — reject it
  timeout: DEFAULT_TIMEOUT_MS,
  ...config,
})

export const safeFetchGet = async <T = unknown>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<AxiosResponse<T>> => {
  await assertPublicUrl(url)
  return axios.get<T>(url, guardedConfig(config))
}

export const safeFetchPost = async <T = unknown>(
  url: string,
  body: unknown,
  config?: AxiosRequestConfig,
): Promise<AxiosResponse<T>> => {
  await assertPublicUrl(url)
  return axios.post<T>(url, body, guardedConfig(config))
}
