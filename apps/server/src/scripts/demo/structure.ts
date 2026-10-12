import type { Role } from '@quill/domain'

/**
 * The shape of the demo organisation: who works there, how it is divided,
 * which workspaces exist and who can read them. The documents themselves are
 * in `content/`; every workspace slug there is declared here.
 */

export const DEMO_ORGANISATION_NAME = 'Acme Software'

/** Every demo person signs in with this, so a demo can be driven as any of them. */
export const DEMO_PASSWORD = 'demo-password-change-me'

export interface DemoPerson {
  readonly email: string
  readonly name: string
}

export const DEMO_PEOPLE: readonly DemoPerson[] = [
  { email: 'priya@acme.example', name: 'Priya Nair' },
  { email: 'marcus@acme.example', name: 'Marcus Lee' },
  { email: 'sofia@acme.example', name: 'Sofia Alvarez' },
  { email: 'tom@acme.example', name: 'Tom Becker' },
  { email: 'aisha@acme.example', name: 'Aisha Khan' },
  { email: 'jonas@acme.example', name: 'Jonas Weber' },
  { email: 'dana@acme.example', name: 'Dana Okafor' },
  { email: 'ravi@acme.example', name: 'Ravi Menon' },
]

/** How the development writer (Ada) relates to a workspace; absent means no access at all. */
export type WriterAccess = Extract<Role, 'viewer' | 'editor'> | 'none'

/** Who may read a workspace without being named on it. */
export type Audience = 'team' | 'company' | 'public'

export interface DemoWorkspace {
  readonly slug: string
  readonly name: string
  /** The division it sits under. */
  readonly unit: string
  readonly audience: Audience
  readonly writer: WriterAccess
}

/**
 * - `team`: only the people who write in it (and administrators) can read it.
 * - `company`: every person can read it; its authors can edit.
 * - `public`: every collection is a public site; its authors can edit.
 */
export const DEMO_WORKSPACES: readonly DemoWorkspace[] = [
  { slug: 'product', name: 'Product', unit: 'Product', audience: 'team', writer: 'viewer' },
  { slug: 'design', name: 'Design system', unit: 'Product', audience: 'public', writer: 'editor' },
  {
    slug: 'mobile-eng',
    name: 'Mobile engineering',
    unit: 'Engineering',
    audience: 'company',
    writer: 'editor',
  },
  {
    slug: 'infra',
    name: 'Platform and infrastructure',
    unit: 'Engineering',
    audience: 'company',
    writer: 'editor',
  },
  {
    slug: 'developers',
    name: 'Developer docs',
    unit: 'Engineering',
    audience: 'public',
    writer: 'editor',
  },
  { slug: 'support', name: 'Support', unit: 'Customer', audience: 'team', writer: 'viewer' },
  { slug: 'help', name: 'Help centre', unit: 'Customer', audience: 'public', writer: 'editor' },
  { slug: 'handbook', name: 'Handbook', unit: 'Operations', audience: 'company', writer: 'viewer' },
  { slug: 'people', name: 'People', unit: 'Operations', audience: 'team', writer: 'none' },
  { slug: 'security', name: 'Security', unit: 'Security', audience: 'team', writer: 'none' },
  {
    slug: 'marketing',
    name: 'Marketing',
    unit: 'Go-to-market',
    audience: 'company',
    writer: 'editor',
  },
]

/** Divisions under the company unit the base seed already creates. */
export const DEMO_UNITS: readonly string[] = [...new Set(DEMO_WORKSPACES.map(({ unit }) => unit))]

/**
 * The labels (ADR-037) the demo's documents write as `:tidepool[Tidepool]`.
 * Each is a colour seed; the theme generator settles contrast.
 */
export const DEMO_LABELS = [
  { name: 'tidepool', title: 'Tidepool', hue: 215 },
  { name: 'skiff', title: 'Skiff', hue: 40 },
  { name: 'api', title: 'API', hue: 285 },
  { name: 'security', title: 'Security', hue: 12 },
] as const
