/**
 * The shapes of the fake API's routes, in a module of their own so the helpers that build routes
 * (`fake-tree-routes.ts`) and the fake client that serves them (`testing.ts`) can both name them
 * without importing each other. `testing.ts` re-exports them: that is where tests import from.
 */

/** Answers one faked request; `params` are the `{param}` segments of its route key. */
export type FakeRouteHandler = (
  request: Request,
  params: Readonly<Record<string, string>>,
) => Response | Promise<Response>

export type FakeRoutes = Readonly<Record<string, FakeRouteHandler>>
