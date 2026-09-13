import { Link } from '@tanstack/react-router'

import type { LinkComponent } from '@quill/ui'

/**
 * The design system's link seam, wired to the router.
 *
 * `@quill/ui`'s primitives describe a destination as a route pattern and its
 * parameters (`LinkTarget`) and render it through whatever `linkComponent`
 * they are given, so that they stay router-agnostic. This is the one adapter
 * the application supplies: every rail item, tree row, breadcrumb step and
 * revision tick becomes a real client-side navigation — preloaded on hover and
 * focus, the shell kept, the query cache kept — instead of a full page load.
 *
 * Two details of the router's own `Link` are pinned here because a design
 * system primitive, not the router, owns the look and the current-ness of what
 * it draws:
 *
 * - `activeOptions.exact`. The router's default is a **prefix** match, which
 *   would make a breadcrumb's `/w/engineering` "active" while reading a
 *   document inside it and force `aria-current="page"` onto an ancestor that
 *   is not the page anybody is on. Exact matching leaves the primitive's own
 *   answer standing: the tree marks the open document, the rail its section.
 * - `activeProps`. The router otherwise appends its own `active` class, which
 *   is a class the variant definitions never wrote and `tailwind-merge` never
 *   saw. `data-status="active"` still arrives, which is the attribute-shaped
 *   version of the same fact (`docs/architecture/styling.md`).
 *
 * Each optional field is spread only when it is present, because the router
 * distinguishes "no search params given" from "search params given as
 * undefined", and a link that passed the second would drop the parameters the
 * route actually has.
 */
export const RouterLink: LinkComponent = ({ to, params, search, hash, children, ...rest }) => (
  <Link
    to={to}
    {...(params === undefined ? {} : { params })}
    {...(search === undefined ? {} : { search })}
    {...(hash === undefined || hash === '' ? {} : { hash })}
    activeOptions={{ exact: true }}
    activeProps={{}}
    {...rest}
  >
    {children}
  </Link>
)
