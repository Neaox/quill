import type { ComponentType, ReactNode } from 'react'

/**
 * Where a link goes, said the way a type-safe router says it.
 *
 * A destination is a **route pattern plus the values its segments take** —
 * `{ to: '/w/$workspaceSlug/d/$documentId', params: { … } }` — never a string
 * somebody has already interpolated. The router is then the one thing that
 * knows how an address is spelled: it type-checks the pattern against the real
 * route tree, encodes each parameter, and serialises search params with the
 * route's own codec. A pre-built `href` throws all three away, which is the
 * mistake this type exists to make impossible (ADR-035: every link comes from
 * a helper, never from string concatenation at the call site).
 *
 * The design system stays router-agnostic all the same: it declares the shape
 * and hands it to whatever `linkComponent` it was given. The application
 * passes TanStack Router's `Link`, whose props these are; a consumer with no
 * router — the design showcase, a server-rendered page — gets `PlainLink`,
 * which resolves the same shape to an `href` itself.
 */
export interface LinkTarget {
  /** The route pattern, with `$name` placeholders for its parameters. */
  readonly to: string
  /** A value per `$name` in the pattern. */
  readonly params?: Readonly<Record<string, string>> | undefined
  /**
   * Search parameters, as values rather than as a query string. A key set to
   * `undefined` is one the route declares and this link does not use, so it is
   * left out of the address entirely.
   */
  readonly search?: Readonly<Record<string, string | number | boolean | undefined>> | undefined
  /** The fragment, without its `#`. */
  readonly hash?: string | undefined
}

/**
 * Everything a primitive hands its `linkComponent`: the destination, the class
 * list the primitive's variants produced, the content, and whichever
 * accessibility facts that primitive carries. A component that only reads some
 * of them is still a valid `LinkComponent`.
 */
export interface LinkRenderProps extends LinkTarget {
  readonly className: string
  readonly children: ReactNode
  /** `page` for the page you are on; `true` where the thing is not a page (a revision). */
  readonly 'aria-current'?: 'page' | 'true' | undefined
  readonly 'aria-label'?: string | undefined
  readonly title?: string | undefined
}

/**
 * The one link seam in the design system.
 *
 * Every primitive that renders a destination takes this, so an application
 * hands its router's `Link` to all of them the same way and gets client-side
 * navigation, preload on intent, and a shell that never unmounts. There is one
 * type rather than one per component, because there is one seam.
 */
export type LinkComponent = ComponentType<LinkRenderProps>

/** `$name`, the parameter placeholder both this and TanStack Router's patterns use. */
const PARAMETER = /\$([A-Za-z0-9_]+)/g

/**
 * A `LinkTarget` as an ordinary URL, for a consumer with no router.
 *
 * Exported because a server-rendered page resolves the same targets the
 * application's router would. Each parameter is encoded, so a title slug with
 * a non-Latin script or a space cannot escape its segment.
 */
export function linkHref({ to, params, search, hash }: LinkTarget): string {
  const path = to.replace(PARAMETER, (placeholder, name: string) => {
    const value = params?.[name]
    return value === undefined ? placeholder : encodeURIComponent(value)
  })
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(search ?? {})) {
    if (value !== undefined) query.set(key, String(value))
  }
  const queryString = query.toString()
  return `${path}${queryString === '' ? '' : `?${queryString}`}${
    hash === undefined || hash === '' ? '' : `#${hash}`
  }`
}

/**
 * The default `linkComponent`: a plain anchor.
 *
 * What the design showcase and any consumer with no router get. It resolves
 * the target itself, so a primitive never has to hold an `href` and the two
 * paths — routed and unrouted — render the same markup.
 */
export const PlainLink: LinkComponent = ({ to, params, search, hash, children, ...rest }) => (
  <a href={linkHref({ to, params, search, hash })} {...rest}>
    {children}
  </a>
)
