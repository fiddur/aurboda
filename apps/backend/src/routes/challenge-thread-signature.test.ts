import { createFederation, type Federation, generateCryptoKeyPair, MemoryKvStore } from '@fedify/fedify'
import { Person } from '@fedify/fedify/vocab'
import express from 'express'
import supertest from 'supertest'
import { describe, expect, test } from 'vitest'

import type { safeFetchGet } from '../services/safe-fetch.ts'

import { createSignedThreadFetch } from '../services/challenge-thread-remote.ts'
import { createSignedActorOf } from './challenge-thread-federation-router.ts'

const HOME = 'https://home.example'
const HOST = 'https://host.example'
const THREAD_PATH = '/users/freja/challenges/nov/thread'

/** Two servers that resolve each other's actors in-process; JSON-LD contexts come from Fedify's preloaded set. */
const twoServers = async () => {
  const servers = new Map<string, Federation<void>>()
  const builtIn = createFederation<void>({ kv: new MemoryKvStore() }).createContext(
    new URL(HOME),
    undefined,
  ).documentLoader
  const loader = async (url: string) => {
    const server = servers.get(new URL(url).origin)
    if (server == null) return builtIn(url)
    const response = await server.fetch(
      new Request(url, { headers: { Accept: 'application/activity+json' } }),
      { contextData: undefined },
    )
    return { contextUrl: null, document: await response.json(), documentUrl: url }
  }
  const server = async (origin: string): Promise<Federation<void>> => {
    const pair = await generateCryptoKeyPair('RSASSA-PKCS1-v1_5')
    const federation = createFederation<void>({
      documentLoaderFactory: () => loader,
      kv: new MemoryKvStore(),
      origin,
    })
    federation
      .setActorDispatcher('/users/{identifier}', async (ctx, identifier) => {
        const keys = await ctx.getActorKeyPairs(identifier)
        return new Person({
          id: ctx.getActorUri(identifier),
          preferredUsername: identifier,
          publicKey: keys[0].cryptographicKey,
        })
      })
      .setKeyPairsDispatcher(async () => [pair])
    servers.set(origin, federation)
    return federation
  }
  return { home: await server(HOME), host: await server(HOST) }
}

const signedHeaders = async (home: Federation<void>, user: string, url: string) => {
  let headers: Record<string, string> = {}
  const capture = (async (_url: string, config?: { headers?: Record<string, string> }) => {
    headers = config?.headers ?? {}
    return { data: {} }
  }) as unknown as typeof safeFetchGet
  await createSignedThreadFetch(home, HOME, capture)(user, url)
  return headers
}

const hostApp = (host: Federation<void>) => {
  const app = express()
  app.set('trust proxy', true)
  const signedActorOf = createSignedActorOf(host)
  app.get(THREAD_PATH, async (req, res) => {
    res.json({ signer: await signedActorOf(req) })
  })
  return app
}

describe('the signed thread request, end to end', () => {
  test("the host recognises the member's actor from a request the member's server signed", async () => {
    const { home, host } = await twoServers()
    const headers = await signedHeaders(home, 'ola', `${HOST}${THREAD_PATH}`)
    const res = await supertest(hostApp(host))
      .get(THREAD_PATH)
      .set({ ...headers, 'X-Forwarded-Proto': 'https' })
    expect(res.body).toEqual({ signer: `${HOME}/users/ola` })
  })

  test('a request signed for another path is nobody', async () => {
    const { home, host } = await twoServers()
    const headers = await signedHeaders(home, 'ola', `${HOST}/users/freja/challenges/other/thread`)
    const res = await supertest(hostApp(host))
      .get(THREAD_PATH)
      .set({ ...headers, 'X-Forwarded-Proto': 'https' })
    expect(res.body).toEqual({ signer: null })
  })

  test('an unsigned request is nobody', async () => {
    const { host } = await twoServers()
    const res = await supertest(hostApp(host)).get(THREAD_PATH).set('Host', 'host.example')
    expect(res.body).toEqual({ signer: null })
  })
})
