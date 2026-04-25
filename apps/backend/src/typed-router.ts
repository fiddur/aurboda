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
import type { ParamsDictionary, Query, RequestHandler, RequestHandlerParams } from 'express-serve-static-core'

import { Router } from 'express'

/**
 * Router method with ResBody defaulting to `never` instead of `any`.
 * Keeps the same overload structure as Express's IRouterMatcher but with stricter defaults.
 */
interface StrictRouterMatcher<T> {
  <
    P extends ParamsDictionary = ParamsDictionary,
    ResBody = never,
    ReqBody = any, // oxlint-disable-line typescript/no-explicit-any -- ReqBody stays `any` for Express compat
    ReqQuery = Query,
  >(
    path: string,
    ...handlers: Array<RequestHandler<P, ResBody, ReqBody, ReqQuery>>
  ): T
  <
    P extends ParamsDictionary = ParamsDictionary,
    ResBody = never,
    ReqBody = any, // oxlint-disable-line typescript/no-explicit-any -- ReqBody stays `any` for Express compat
    ReqQuery = Query,
  >(
    path: string,
    ...handlers: Array<RequestHandlerParams<P, ResBody, ReqBody, ReqQuery>>
  ): T
}

/**
 * Router with strict response typing. Uses intersection with Router so that
 * TypedRouter IS-A Router (no `as unknown as Router` cast needed at boundaries).
 * The StrictRouterMatcher overloads take priority in call-site resolution.
 */
export type TypedRouter = Router & {
  get: StrictRouterMatcher<TypedRouter>
  post: StrictRouterMatcher<TypedRouter>
  put: StrictRouterMatcher<TypedRouter>
  patch: StrictRouterMatcher<TypedRouter>
  delete: StrictRouterMatcher<TypedRouter>
}

/** Create an Express Router with strict response typing (ResBody defaults to `never`). */
export const typedRouter = (): TypedRouter => Router() as TypedRouter
