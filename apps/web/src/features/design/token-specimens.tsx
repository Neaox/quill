import { Block, cx, DataTable, ScrollGroup } from '@quill/ui'

import { Specimen } from './specimen-layout.tsx'

interface TypeRow {
  readonly token: string
  readonly size: string
  readonly className: string
}

const SAMPLE = 'Documentation that stays readable'

const TYPE_SCALE: readonly TypeRow[] = [
  { token: 'text-4xl', size: '2.488rem', className: 'text-4xl font-semibold tracking-tight' },
  { token: 'text-3xl', size: '2.074rem', className: 'text-3xl font-semibold tracking-tight' },
  { token: 'text-2xl', size: '1.728rem', className: 'text-2xl font-semibold tracking-tight' },
  { token: 'text-xl', size: '1.44rem', className: 'text-xl font-semibold tracking-tight' },
  { token: 'text-lg', size: '1.2rem', className: 'text-lg' },
  { token: 'text-reading', size: '1.0625rem', className: 'font-reading text-reading' },
  { token: 'text-base', size: '1rem', className: 'text-base' },
  { token: 'text-sm', size: '0.875rem', className: 'text-sm' },
  { token: 'text-xs', size: '0.833rem', className: 'text-xs' },
  { token: 'text-2xs', size: '0.694rem', className: 'meta' },
]

interface Face {
  readonly token: string
  readonly role: string
  readonly className: string
  readonly sample: string
}

const FACES: readonly Face[] = [
  {
    token: '--font-display',
    role: 'display',
    className: 'font-display text-2xl',
    sample: 'Authentication',
  },
  {
    token: '--font-sans',
    role: 'interface',
    className: 'font-sans text-lg',
    sample: 'Interface, labels, headings',
  },
  {
    token: '--font-reading',
    role: 'reading',
    className: 'font-reading text-lg',
    sample: 'Long-form document body',
  },
  {
    token: '--font-mono',
    role: 'mono',
    className: 'font-mono text-base',
    sample: 'v12 · 2026-08-15',
  },
]

interface Swatch {
  readonly token: string
  readonly className: string
}

const SURFACES: readonly Swatch[] = [
  { token: 'background', className: 'bg-background' },
  { token: 'surface', className: 'bg-surface' },
  { token: 'surface-raised', className: 'bg-surface-raised' },
  { token: 'code-background', className: 'bg-code-background' },
  { token: 'border', className: 'bg-border' },
  { token: 'border-strong', className: 'bg-border-strong' },
]

const INK: readonly Swatch[] = [
  { token: 'foreground', className: 'bg-foreground' },
  { token: 'muted', className: 'bg-muted' },
  { token: 'accent', className: 'bg-accent' },
  { token: 'success', className: 'bg-success' },
  { token: 'warning', className: 'bg-warning' },
  { token: 'danger', className: 'bg-danger' },
]

const SUBTLE: readonly Swatch[] = [
  { token: 'accent-subtle', className: 'bg-accent-subtle' },
  { token: 'success-subtle', className: 'bg-success-subtle' },
  { token: 'warning-subtle', className: 'bg-warning-subtle' },
  { token: 'danger-subtle', className: 'bg-danger-subtle' },
  { token: 'selection', className: 'bg-selection' },
]

/** The syntax families, each named once and coloured by its own variable. */
const SYNTAX = [
  'keyword',
  'string',
  'number',
  'function',
  'variable',
  'regex',
  'comment',
  'punctuation',
  'inserted',
  'deleted',
] as const

function SwatchRow({ swatches }: { readonly swatches: readonly Swatch[] }) {
  return (
    <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
      {swatches.map((swatch) => (
        <li key={swatch.token} className="flex flex-col gap-1.5">
          <span
            className={cx('h-10 rounded-md border border-border', swatch.className)}
            aria-hidden="true"
          />
          <span className="meta">{swatch.token}</span>
        </li>
      ))}
    </ul>
  )
}

/** Type: the scale, and the four faces the identity in scope has chosen. */
export function TypeSpecimens() {
  return (
    <>
      <Specimen
        label="Type scale"
        note="One modular scale, ratio 1.2, anchored at 1rem. Never a theme's to change."
        bodyClassName="flex flex-col gap-3"
      >
        {TYPE_SCALE.map((row) => (
          <div
            key={row.token}
            className="flex flex-col gap-0.5 border-b border-border pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-6"
          >
            <div className="flex shrink-0 items-baseline gap-2 whitespace-nowrap sm:w-48">
              <code className="meta text-accent">{row.token}</code>
              <span className="meta">{row.size}</span>
            </div>
            <p className={cx('min-w-0 truncate text-foreground', row.className)}>{SAMPLE}</p>
          </div>
        ))}
      </Specimen>

      <Specimen
        label="Type pairing"
        note="Four roles, chosen by the theme from the curated self-hosted set"
        bodyClassName="grid gap-5 sm:grid-cols-2"
      >
        {FACES.map((face) => (
          <div key={face.token} className="flex flex-col gap-1">
            <p className="meta">
              {face.role} · {face.token}
            </p>
            <p className={cx('truncate text-foreground', face.className)}>{face.sample}</p>
          </div>
        ))}
      </Specimen>
    </>
  )
}

/** Colour: the generated surfaces, ink, status set, and syntax families. */
export function ColourSpecimens() {
  return (
    <>
      <Specimen
        label="Surfaces and borders"
        note="Generated from the tone seed; never written by hand"
        bodyClassName="flex flex-col gap-4"
      >
        <SwatchRow swatches={SURFACES} />
      </Specimen>

      <Specimen
        label="Ink, accent, and status"
        note="One signal colour: the accent. Status always carries a word as well."
        bodyClassName="flex flex-col gap-4"
      >
        <SwatchRow swatches={INK} />
        <SwatchRow swatches={SUBTLE} />
      </Specimen>

      <Specimen
        label="Syntax families"
        note="--token-* per class, read by both .tok-* and ::highlight() rules"
        bodyClassName="flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs"
      >
        {SYNTAX.map((family) => {
          // The class is the specimen, so it is data rather than a choice made
          // from state; naming it here keeps `className` a plain reference.
          const tokenClass = `tok-${family}`
          return (
            <span key={family} className={tokenClass}>
              {family}
            </span>
          )
        })}
      </Specimen>
    </>
  )
}

/** Shape, elevation, and motion: the parts a theme moves and the parts it cannot. */
export function ShapeSpecimens() {
  return (
    <Specimen label="Shape, elevation, and motion" bodyClassName="grid gap-6 sm:grid-cols-3">
      <div className="flex flex-col gap-2.5">
        <p className="meta">radius · the theme's step</p>
        <div className="flex items-end gap-2">
          {['rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-xl'].map((radius) => (
            <span
              key={radius}
              className={cx('size-9 border border-border bg-surface', radius)}
              aria-hidden="true"
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <p className="meta">shadow</p>
        <div className="flex items-end gap-3">
          {['shadow-raised', 'shadow-overlay', 'shadow-dialog'].map((shadow) => (
            <span
              key={shadow}
              className={cx('size-9 rounded-md bg-surface-raised', shadow)}
              aria-hidden="true"
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="meta">duration · never themable</p>
        <ul className="meta-value flex flex-col">
          <li>instant · 80ms</li>
          <li>fast · 140ms</li>
          <li>base · 220ms</li>
          <li>slow · 360ms</li>
        </ul>
        <p className="text-2xs leading-relaxed text-muted">
          Reduced motion collapses every duration token to 1ms, so a component cannot forget to opt
          in.
        </p>
      </div>
    </Specimen>
  )
}

/** One reading grid, at whatever width its container gives it. */
function GridSample() {
  return (
    <div className="layout-grid gap-y-2.5 py-5">
      <div className="layout-content rounded-md border border-accent/40 bg-accent-subtle px-3 py-2 text-2xs text-accent">
        <code className="font-mono">content</code> — the reading measure
      </div>
      <div className="layout-wide rounded-md border border-border bg-surface px-3 py-2 text-2xs text-muted">
        <code className="font-mono">wide</code> — tables and diagrams
      </div>
      <div className="layout-full rounded-md border border-dashed border-border-strong px-3 py-2 text-2xs text-muted">
        <code className="font-mono">full</code> — the whole region
      </div>
    </div>
  )
}

interface GridCase {
  readonly id: string
  readonly label: string
  readonly className: string
}

const GRID_CASES: readonly GridCase[] = [
  {
    id: 'wide',
    label: '68rem — all three widths distinct',
    className: 'min-w-272',
  },
  {
    id: 'page',
    label: 'the room this page has, beside the tree and the panel — wide and full are the same',
    className: 'w-full',
  },
  {
    id: 'pane',
    label: '30rem, a preview pane or a phone — one column',
    className: 'max-w-120',
  },
]

/**
 * The three layout widths of ADR-027, at three container widths.
 *
 * The grid collapses on its own container rather than on the window, so the
 * same document lays out correctly beside a comments panel, in a preview pane,
 * and on a phone. Narrow the window and these three do not change, because
 * none of them is reading the window.
 */
export function LayoutSpecimen() {
  return (
    <Block width="full" className="mt-6">
      <div className="overflow-hidden rounded-lg border border-border bg-surface-raised">
        <div className="border-b border-border bg-surface px-4 py-2">
          <p className="meta">Named-line grid · collapsing on its container</p>
        </div>
        <ul className="flex flex-col gap-4 p-4">
          {GRID_CASES.map((gridCase) => (
            <li key={gridCase.id} className="flex flex-col gap-1" data-grid-case={gridCase.id}>
              <p className="meta">{gridCase.label}</p>
              <ScrollGroup
                label={gridCase.label}
                className="rounded-md border border-dashed border-border"
              >
                <div className={gridCase.className}>
                  <GridSample />
                </div>
              </ScrollGroup>
            </li>
          ))}
        </ul>
      </div>
    </Block>
  )
}

/** The rule treatment a theme chooses: hairline, double, or cards. */
export function RulesSpecimen({ chosen }: { readonly chosen: string }) {
  return (
    <Specimen
      label="Rules"
      note={`this identity uses ${chosen}; each panel below reads the rules-* variants`}
      bodyClassName="grid gap-5 sm:grid-cols-3"
    >
      {(['hairline', 'double', 'cards'] as const).map((rules) => (
        <div key={rules} data-rules={rules} className="flex flex-col gap-3">
          <p className="meta">{rules}</p>
          <hr
            className={cx(
              'm-0 border-0',
              'rules-hairline:border-t rules-hairline:border-border',
              'rules-double:h-0.75 rules-double:border-t-3 rules-double:border-double',
              'rules-double:border-foreground',
            )}
          />
          <div
            className={cx(
              'text-2xs leading-relaxed text-muted',
              'rules-hairline:border-t rules-hairline:border-border rules-hairline:pt-5',
              'rules-double:border-t-3 rules-double:border-double',
              'rules-double:border-foreground rules-double:pt-5',
              'rules-cards:rounded-xl rules-cards:border rules-cards:border-border',
              'rules-cards:bg-surface-raised rules-cards:p-5 rules-cards:shadow-raised',
            )}
          >
            A panel separated the way this treatment separates things.
          </div>
        </div>
      ))}
    </Specimen>
  )
}

/** A table outside a document: the treatment the data table carries. */
export function DataTableSpecimen() {
  return (
    <Specimen
      label="Data table"
      note="28px rows, monospace headings, a 2px rule"
      bodyClassName="p-0"
    >
      <DataTable label="Endpoint budgets" className="px-4 py-3">
        <thead>
          <tr>
            <th scope="col">endpoint</th>
            <th scope="col">method</th>
            <th scope="col">auth</th>
            <th scope="col">budget</th>
            <th scope="col">owner</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['/auth/token', 'POST', 'Client secret', '120 ms', 'Identity'],
            ['/auth/refresh', 'POST', 'Refresh token', '80 ms', 'Identity'],
            ['/auth/introspect', 'POST', 'Service mTLS', '15 ms', 'Gateway'],
            ['/auth/revoke', 'POST', 'Client secret', '200 ms', 'Identity'],
          ].map(([endpoint, method, auth, budget, owner]) => (
            <tr key={endpoint}>
              <th scope="row" className="font-mono">
                {endpoint}
              </th>
              <td className="font-mono">{method}</td>
              <td>{auth}</td>
              <td className="font-mono">{budget}</td>
              <td>{owner}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </Specimen>
  )
}
