/**
 * Typed Express Router wrapper that defaults ResBody to `never`.
 *
 * This forces every route handler to explicitly declare its response type,
 * ensuring the API contract between frontend and backend is enforced at
 * compile time. Without an explicit ResBody type parameter, `res.json()`
 * will fail because the argument is not assignable to `never`.
 *
 * Usage:
 *   const router = typedRouter()
 *   router.get<{}, MyResponse>('/', handler)              // OK
 *   router.get<{ id: string }, MyResponse>('/:id', ...)   // OK
 *   router.get('/', (req, res) => res.json({ x: 1 }))    // ERROR: not assignable to never
 */
import type { ParamsDictionary, RequestHandler, RequestHandlerParams } from 'express-serve-static-core'

import { Router } from 'express'

/**
 * Router method with ResBody defaulting to `never` instead of `any`.
 * Keeps the same overload structure as Express's IRouterMatcher but with stricter defaults.
 */
interface StrictRouterMatcher<T> {
  <P extends ParamsDictionary = ParamsDictionary, ResBody = never, ReqBody = unknown>(
    path: string,
    ...handlers: Array<RequestHandler<P, ResBody, ReqBody>>
  ): T
  <P extends ParamsDictionary = ParamsDictionary, ResBody = never, ReqBody = unknown>(
    path: string,
    ...handlers: Array<RequestHandlerParams<P, ResBody, ReqBody>>
  ): T
}

export interface TypedRouter extends Omit<Router, 'get' | 'post' | 'put' | 'patch' | 'delete'> {
  get: StrictRouterMatcher<this>
  post: StrictRouterMatcher<this>
  put: StrictRouterMatcher<this>
  patch: StrictRouterMatcher<this>
  delete: StrictRouterMatcher<this>
}

/** Create an Express Router with strict response typing (ResBody defaults to `never`). */
export const typedRouter = (): TypedRouter => Router() as unknown as TypedRouter
