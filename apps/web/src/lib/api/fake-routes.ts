/**
 * The shapes of a fake route table, in a module of their own so the fake
 * client (`testing.ts`) and the routes derived for it (`fake-tree-routes.ts`)
 * can both depend on them without depending on each other.
 *
 * A route key is `"METHOD /api/path/{param}"`, matching the path syntax
 * `@quill/api-client`'s `paths` type already uses, so a test route reads like
 * the route it fakes.
 */
export type FakeRouteHandler = (
  request: Request,
  params: Readonly<Record<string, string>>,
) => Response | Promise<Response>

export type FakeRoutes = Readonly<Record<string, FakeRouteHandler>>
