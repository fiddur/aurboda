import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isKotlinSkippedPath, kotlinOpenApiDocument } from './openapi-kotlin-filter.ts'

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const jsonResponse = (schema: object) => ({
  responses: { 200: { content: { 'application/json': { schema } }, description: 'OK' } },
})

const fullDocument = {
  components: {
    responses: { ReadOnly: { content: { 'application/json': { schema: ref('ReadOnlyResponse') } } } },
    schemas: {
      ErrorResponse: { properties: { error: { type: 'string' } }, type: 'object' },
      FeedPost: { properties: { structured: ref('StructuredPayload') }, type: 'object' },
      FeedPostResponse: { properties: { post: ref('FeedPost') }, type: 'object' },
      Person: { properties: { name: { type: 'string' } }, type: 'object' },
      PersonPostsResponse: { items: ref('TimelineEntry'), type: 'array' },
      ReadOnlyResponse: { properties: { error: { type: 'string' } }, type: 'object' },
      Registered: { properties: { visibility: ref('Visibility') }, type: 'object' },
      StructuredPayload: { oneOf: [{ type: 'object' }, { type: 'string' }] },
      TimelineEntry: { properties: { post: ref('FeedPost'), visibility: ref('Visibility') }, type: 'object' },
      Visibility: { enum: ['public', 'followers'], type: 'string' },
    },
  },
  paths: {
    '/feed': { get: jsonResponse(ref('FeedPostResponse')) },
    '/feed/{postId}': {
      delete: { responses: { 402: { $ref: '#/components/responses/ReadOnly' } } },
      get: jsonResponse(ref('FeedPostResponse')),
    },
    '/feed/timeline': { get: jsonResponse(ref('PersonPostsResponse')) },
    '/feeds-elsewhere': { get: jsonResponse(ref('ErrorResponse')) },
    '/people/{id}': {
      get: jsonResponse(ref('Person')),
      patch: { responses: { 402: { $ref: '#/components/responses/ReadOnly' } } },
    },
    '/people/{id}/posts': { get: jsonResponse(ref('PersonPostsResponse')) },
  },
}

describe('isKotlinSkippedPath', () => {
  it('skips the feed and a person’s posts, and nothing that merely starts alike', () => {
    assert.equal(isKotlinSkippedPath('/feed'), true)
    assert.equal(isKotlinSkippedPath('/feed/timeline/{id}/like'), true)
    assert.equal(isKotlinSkippedPath('/people/{id}/posts'), true)
    assert.equal(isKotlinSkippedPath('/feeds-elsewhere'), false)
    assert.equal(isKotlinSkippedPath('/people/{id}'), false)
    assert.equal(isKotlinSkippedPath('/people/{id}/dates'), false)
  })
})

describe('kotlinOpenApiDocument', () => {
  const filtered = kotlinOpenApiDocument(fullDocument)
  const schemaNames = Object.keys(filtered.components.schemas)

  it('leaves the full document describing the feed', () => {
    assert.ok('/feed' in fullDocument.paths)
    assert.ok('/feed/timeline' in fullDocument.paths)
    assert.ok('/people/{id}/posts' in fullDocument.paths)
    assert.ok('FeedPost' in fullDocument.components.schemas)
  })

  it('drops every feed path and a person’s posts', () => {
    assert.deepEqual(Object.keys(filtered.paths).sort(), ['/feeds-elsewhere', '/people/{id}'])
  })

  it('drops the schemas only the skipped paths reached', () => {
    for (const name of [
      'FeedPost',
      'FeedPostResponse',
      'PersonPostsResponse',
      'StructuredPayload',
      'TimelineEntry',
    ]) {
      assert.ok(!schemaNames.includes(name), `${name} should be pruned`)
    }
  })

  it('keeps a schema a kept path reaches, also through a shared component response', () => {
    assert.ok(schemaNames.includes('ErrorResponse'))
    assert.ok(schemaNames.includes('Person'))
    assert.ok(schemaNames.includes('ReadOnlyResponse'))
  })

  it('keeps a registered schema no path reaches, and what it reaches', () => {
    assert.ok(schemaNames.includes('Registered'))
    assert.ok(schemaNames.includes('Visibility'))
  })

  it('leaves the other components alone', () => {
    assert.deepEqual(filtered.components.responses, fullDocument.components.responses)
  })
})
