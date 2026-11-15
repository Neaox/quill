import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { Button, Callout, Input, Spinner } from '@quill/ui'

import {
  useLoadedWorkspace,
  useReference,
  useReferenceArtifact,
  type ReferenceArtifact,
  type ReferenceKind,
  type ReferenceSnapshotDto,
} from '../../lib/api/index.ts'

const routeApi = getRouteApi('/_authenticated/w/$workspaceSlug/reference')

/**
 * The workspace's reference index (ADR-065): the last code and schema
 * snapshots an ingestion stored, and a browser over one of them.
 *
 * The page does not fetch the artifact until a reader asks for it. A code
 * index is tens of megabytes, and the snapshot's provenance — when it was
 * captured, from which commit, how many symbols or tables — answers half the
 * question before the bytes arrive.
 *
 * Code results need a query: eighteen thousand symbols are not a list a page
 * should draw, so an empty search says how many there are and asks for a
 * name. Schema contents are smaller and open by default.
 */
export function ReferencePage() {
  const { workspaceSlug } = routeApi.useParams()
  const search = routeApi.useSearch()
  const navigate = useNavigate()
  const workspace = useLoadedWorkspace(workspaceSlug).data
  const kind: ReferenceKind = search.kind === 'code' ? 'code' : 'schema'
  const query = search.q ?? ''

  const reference = useReference(workspace.id, kind)
  const latest = reference.data?.latest ?? null
  const [loaded, setLoaded] = useState<string | null>(null)
  const artifact = useReferenceArtifact(
    workspace.id,
    kind,
    latest?.id,
    latest !== null && loaded === latest.id,
  )

  const setKind = (next: ReferenceKind): void => {
    void navigate({
      to: '/w/$workspaceSlug/reference',
      params: { workspaceSlug },
      search: (previous) => {
        const nextSearch = { ...previous }
        if (next === 'schema') delete nextSearch.kind
        else nextSearch.kind = next
        return nextSearch
      },
      replace: true,
    })
  }

  const setQuery = (next: string): void => {
    void navigate({
      to: '/w/$workspaceSlug/reference',
      params: { workspaceSlug },
      search: (previous) => {
        const nextSearch = { ...previous }
        if (next === '') delete nextSearch.q
        else nextSearch.q = next
        return nextSearch
      },
      replace: true,
    })
  }

  return (
    <div className="flex flex-col gap-6 px-8 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-foreground">Reference</h1>
        <p className="max-w-2xl text-sm text-muted">
          The code and database facts this workspace was last indexed from, with the commit and
          instant the index recorded.
        </p>
      </header>

      <div
        className="flex w-fit items-center gap-1 rounded-lg border border-border bg-surface p-1"
        role="group"
        aria-label="Reference kind"
      >
        <button
          type="button"
          aria-pressed={kind === 'schema'}
          onClick={() => setKind('schema')}
          className="rounded-md px-3 py-1 text-xs text-muted hover:text-foreground aria-pressed:bg-surface-raised aria-pressed:font-medium aria-pressed:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          Schema
        </button>
        <button
          type="button"
          aria-pressed={kind === 'code'}
          onClick={() => setKind('code')}
          className="rounded-md px-3 py-1 text-xs text-muted hover:text-foreground aria-pressed:bg-surface-raised aria-pressed:font-medium aria-pressed:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          Code
        </button>
      </div>

      {reference.isPending ? <Spinner /> : null}
      {reference.isError ? (
        <Callout tone="danger" title="The reference index could not be read">
          Reload the page to try again.
        </Callout>
      ) : null}

      {reference.isSuccess && latest === null ? (
        <Callout tone="info" title="No snapshot yet">
          Nothing has been ingested for this workspace. The reference is built from a code index and
          a schema capture, each stored with the commit it came from.
        </Callout>
      ) : null}

      {latest === null ? null : (
        <Snapshot
          snapshot={latest}
          kind={kind}
          loaded={loaded === latest.id}
          onLoad={() => setLoaded(latest.id)}
          loading={artifact.isFetching}
        />
      )}

      {artifact.isError ? (
        <Callout tone="danger" title="That snapshot's artifact could not be read">
          It may have been swept from the blob store. Ingest the artifact again to restore it.
        </Callout>
      ) : null}

      {loaded !== null && artifact.isSuccess ? (
        kind === 'schema' ? (
          <SchemaContents artifact={artifact.data} query={query} onQuery={setQuery} />
        ) : (
          <CodeContents artifact={artifact.data} query={query} onQuery={setQuery} />
        )
      ) : null}
    </div>
  )
}

function Snapshot({
  snapshot,
  kind,
  loaded,
  loading,
  onLoad,
}: {
  readonly snapshot: ReferenceSnapshotDto
  readonly kind: ReferenceKind
  readonly loaded: boolean
  readonly loading: boolean
  readonly onLoad: () => void
}) {
  return (
    <section
      aria-labelledby="reference-snapshot"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-5 py-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="reference-snapshot" className="text-sm font-semibold text-foreground">
            {kind === 'schema' ? 'Schema snapshot' : 'Code snapshot'}
          </h2>
          <p className="mt-1 text-xs text-muted">
            Captured <time dateTime={snapshot.capturedAt}>{readableDate(snapshot.capturedAt)}</time>{' '}
            from commit <code className="text-foreground">{snapshot.sourceCommit}</code>
          </p>
        </div>
        <Button type="button" onClick={onLoad} disabled={loading}>
          {loaded ? 'Load again' : 'Load snapshot'}
        </Button>
      </div>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs sm:grid-cols-4">
        {kind === 'schema' ? (
          <Fact label="Tables" value={String(snapshot.tableCount)} />
        ) : (
          <Fact label="Symbols" value={String(snapshot.symbolCount)} />
        )}
        <Fact label="Artifact" value={readableBytes(snapshot.artifactSize)} />
        <Fact label="Format" value={`version ${String(snapshot.artifactVersion)}`} />
      </dl>
    </section>
  )
}

function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  )
}

function SchemaContents({
  artifact,
  query,
  onQuery,
}: {
  readonly artifact: ReferenceArtifact
  readonly query: string
  readonly onQuery: (value: string) => void
}) {
  const parsed = useMemo(() => readSchema(artifact), [artifact])
  if (parsed === null) {
    return (
      <Callout tone="danger" title="This schema artifact cannot be read">
        Its shape is not the one this page knows. Ingest a snapshot from the current reader.
      </Callout>
    )
  }
  const needle = query.trim().toLowerCase()
  const tables = parsed.tables.filter((table) => matchesTable(table, needle))
  const functions = parsed.functions.filter((fn) => matchesFunction(fn, needle))
  const namespaces = Map.groupBy(tables, (table) => table.schema)

  return (
    <section aria-labelledby="reference-contents" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="reference-contents" className="text-sm font-semibold text-foreground">
          {tables.length} of {parsed.tables.length} tables, {functions.length} of{' '}
          {parsed.functions.length} functions
        </h2>
        <FilterForm
          label="Filter tables and functions"
          query={query}
          placeholder="booking, finance, occupancy…"
          onQuery={onQuery}
        />
      </div>

      {[...namespaces.entries()]
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([namespace, group]) => (
          <section
            key={namespace}
            aria-labelledby={`namespace-${namespace}`}
            className="flex flex-col gap-2"
          >
            <h3
              id={`namespace-${namespace}`}
              className="text-xs font-semibold tracking-wide text-muted uppercase"
            >
              {namespace}
            </h3>
            <div className="flex flex-col gap-2">
              {group
                .toSorted((left, right) => left.name.localeCompare(right.name))
                .map((table) => (
                  <TableCard key={`${table.schema}.${table.name}`} table={table} />
                ))}
            </div>
          </section>
        ))}

      {functions.length === 0 ? null : (
        <section aria-labelledby="reference-functions" className="flex flex-col gap-2">
          <h3
            id="reference-functions"
            className="text-xs font-semibold tracking-wide text-muted uppercase"
          >
            Functions
          </h3>
          <div className="flex flex-col gap-2">
            {functions.map((fn) => (
              <details
                key={fn.signature}
                className="rounded-lg border border-border bg-surface px-4 py-3"
              >
                <summary className="cursor-pointer text-sm text-foreground">
                  <code>{fn.signature}</code>
                </summary>
                {fn.comment === undefined ? null : (
                  <p className="mt-2 max-w-3xl text-sm text-muted">{fn.comment}</p>
                )}
                {fn.returns === undefined ? null : (
                  <p className="mt-1 text-xs text-muted">
                    Returns <code>{fn.returns}</code>
                  </p>
                )}
              </details>
            ))}
          </div>
        </section>
      )}
    </section>
  )
}

function FilterForm({
  label,
  query,
  placeholder,
  onQuery,
}: {
  readonly label: string
  readonly query: string
  readonly placeholder: string
  readonly onQuery: (value: string) => void
}) {
  return (
    <form
      className="flex w-full max-w-md items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        const value = new FormData(event.currentTarget).get('q')
        onQuery(typeof value === 'string' ? value : '')
      }}
    >
      <Input label={label} name="q" type="search" defaultValue={query} placeholder={placeholder} />
      <Button type="submit">Filter</Button>
    </form>
  )
}

function TableCard({ table }: { readonly table: SchemaTable }) {
  return (
    <details className="rounded-lg border border-border bg-surface px-4 py-3">
      <summary className="cursor-pointer text-sm text-foreground">
        <code>
          {table.schema}.{table.name}
        </code>
        {table.comment === undefined ? null : (
          <span className="ms-2 text-muted">{firstSentence(table.comment)}</span>
        )}
      </summary>
      {table.comment === undefined ? null : (
        <p className="mt-3 max-w-3xl text-sm text-muted">{table.comment}</p>
      )}
      {table.columns.length === 0 ? null : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <caption className="sr-only">
              Columns of {table.schema}.{table.name}
            </caption>
            <thead>
              <tr className="border-b border-border text-muted">
                <th scope="col" className="py-1 pe-4 font-medium">
                  Column
                </th>
                <th scope="col" className="py-1 pe-4 font-medium">
                  Type
                </th>
                <th scope="col" className="py-1 pe-4 font-medium">
                  Null
                </th>
                <th scope="col" className="py-1 pe-4 font-medium">
                  Key
                </th>
                <th scope="col" className="py-1 pe-4 font-medium">
                  Default
                </th>
                <th scope="col" className="py-1 font-medium">
                  Comment
                </th>
              </tr>
            </thead>
            <tbody>
              {table.columns.map((column) => (
                <tr key={column.name} className="border-b border-border/60 last:border-0">
                  <th scope="row" className="py-1 pe-4 font-mono font-normal text-foreground">
                    {column.name}
                  </th>
                  <td className="py-1 pe-4 font-mono text-muted">{column.type}</td>
                  <td className="py-1 pe-4 text-muted">{column.nullable ? 'yes' : 'no'}</td>
                  <td className="py-1 pe-4 text-muted">
                    {column.primaryKey ? 'PK' : column.unique ? 'UQ' : ''}
                    {column.references === undefined ? '' : ` FK → ${column.references.table}`}
                  </td>
                  <td className="py-1 pe-4 font-mono text-muted">{column.default ?? ''}</td>
                  <td className="max-w-xl py-1 text-muted">{column.comment ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  )
}

function CodeContents({
  artifact,
  query,
  onQuery,
}: {
  readonly artifact: ReferenceArtifact
  readonly query: string
  readonly onQuery: (value: string) => void
}) {
  const symbols = useMemo(() => readCode(artifact), [artifact])
  if (symbols === null) {
    return (
      <Callout tone="danger" title="This code artifact cannot be read">
        Its shape is not the one this page knows. Ingest a snapshot from the current toolchain.
      </Callout>
    )
  }
  const needle = query.trim().toLowerCase()
  if (needle.length < 2) {
    return (
      <section aria-labelledby="reference-contents" className="flex flex-col gap-3">
        <h2 id="reference-contents" className="text-sm font-semibold text-foreground">
          {symbols.length.toLocaleString()} symbols
        </h2>
        <FilterForm
          label="Find a symbol"
          query={query}
          placeholder="Two characters or more: name, signature or doc text"
          onQuery={onQuery}
        />
        <p className="text-sm text-muted">
          Type at least two characters to search the artifact. The page reads it from this browser
          only after you load it; nothing is sent anywhere.
        </p>
      </section>
    )
  }

  const matches = symbols.filter((symbol) => matchesSymbol(symbol, needle)).slice(0, 100)
  return (
    <section aria-labelledby="reference-contents" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="reference-contents" className="text-sm font-semibold text-foreground">
          {matches.length} of {symbols.length.toLocaleString()} symbols
        </h2>
        <FilterForm
          label="Find a symbol"
          query={query}
          placeholder="name, signature or doc text"
          onQuery={onQuery}
        />
      </div>
      {matches.length === 0 ? (
        <p className="text-sm text-muted">No symbol matches “{query.trim()}”.</p>
      ) : (
        <ol aria-label="Symbols" className="flex flex-col gap-2">
          {matches.map((symbol) => (
            <li
              key={`${symbol.package}/${symbol.module}/${symbol.name}`}
              className="rounded-lg border border-border bg-surface px-4 py-3"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="text-sm font-semibold text-foreground">{symbol.name}</h3>
                <span className="text-xs text-muted">{symbol.kind}</span>
                <span className="text-xs text-muted">
                  {symbol.package}/{symbol.module}
                </span>
              </div>
              <pre className="mt-2 overflow-x-auto text-xs text-foreground">
                <code>{symbol.signature}</code>
              </pre>
              {symbol.description === '' ? null : (
                <p className="mt-2 max-w-3xl text-sm text-muted">{symbol.description}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Artifact shapes
// ---------------------------------------------------------------------------

interface SchemaColumn {
  readonly name: string
  readonly type: string
  readonly nullable: boolean
  readonly default?: string
  readonly primaryKey: boolean
  readonly unique: boolean
  readonly references?: { readonly table: string }
  readonly comment?: string
}

interface SchemaTable {
  readonly schema: string
  readonly name: string
  readonly columns: readonly SchemaColumn[]
  readonly comment?: string
}

interface SchemaFunction {
  readonly signature: string
  readonly returns?: string
  readonly comment?: string
}

interface CodeSymbol {
  readonly name: string
  readonly kind: string
  readonly package: string
  readonly module: string
  readonly signature: string
  readonly description: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stringAt = (value: Record<string, unknown>, key: string): string | undefined =>
  typeof value[key] === 'string' ? value[key] : undefined

function readSchema(artifact: ReferenceArtifact): {
  readonly tables: readonly SchemaTable[]
  readonly functions: readonly SchemaFunction[]
} | null {
  if (!isRecord(artifact) || !Array.isArray(artifact['tables'])) return null
  const tables: SchemaTable[] = []
  for (const value of artifact['tables']) {
    if (!isRecord(value)) continue
    const schema = stringAt(value, 'schema')
    const name = stringAt(value, 'name')
    if (schema === undefined || name === undefined) continue
    const columns = Array.isArray(value['columns'])
      ? value['columns'].flatMap((column) => (isRecord(column) ? [readColumn(column)] : []))
      : []
    const comment = stringAt(value, 'comment')
    tables.push({ schema, name, columns, ...(comment === undefined ? {} : { comment }) })
  }
  const functions = Array.isArray(artifact['functions'])
    ? artifact['functions'].flatMap((fn) => {
        if (!isRecord(fn)) return []
        const signature = stringAt(fn, 'signature')
        if (signature === undefined) return []
        const returns = stringAt(fn, 'returns')
        const comment = stringAt(fn, 'comment')
        return [
          {
            signature,
            ...(returns === undefined ? {} : { returns }),
            ...(comment === undefined ? {} : { comment }),
          },
        ]
      })
    : []
  return { tables, functions }
}

function readColumn(value: Record<string, unknown>): SchemaColumn {
  const name = stringAt(value, 'name') ?? ''
  const type = stringAt(value, 'type') ?? ''
  const defaultValue = stringAt(value, 'default')
  const comment = stringAt(value, 'comment')
  const reference = isRecord(value['references'])
    ? stringAt(value['references'], 'table')
    : undefined
  return {
    name,
    type,
    nullable: value['nullable'] === true,
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
    primaryKey: value['primaryKey'] === true,
    unique: value['unique'] === true,
    ...(reference === undefined ? {} : { references: { table: reference } }),
    ...(comment === undefined ? {} : { comment }),
  }
}

function readCode(artifact: ReferenceArtifact): readonly CodeSymbol[] | null {
  if (!isRecord(artifact) || !isRecord(artifact['files'])) return null
  const symbols: CodeSymbol[] = []
  for (const file of Object.values(artifact['files'])) {
    if (!isRecord(file) || !Array.isArray(file['symbols'])) continue
    for (const value of file['symbols']) {
      if (!isRecord(value)) continue
      const name = stringAt(value, 'name')
      const signature = stringAt(value, 'signature')
      if (name === undefined || signature === undefined) continue
      symbols.push({
        name,
        signature,
        kind: stringAt(value, 'kind') ?? 'symbol',
        package: stringAt(value, 'package') ?? '',
        module: stringAt(value, 'module') ?? '',
        description: stringAt(value, 'description') ?? '',
      })
    }
  }
  return symbols
}

function matchesTable(table: SchemaTable, needle: string): boolean {
  if (needle === '') return true
  if (
    `${table.schema}.${table.name}`.toLowerCase().includes(needle) ||
    (table.comment ?? '').toLowerCase().includes(needle)
  ) {
    return true
  }
  return table.columns.some(
    (column) =>
      column.name.toLowerCase().includes(needle) ||
      (column.comment ?? '').toLowerCase().includes(needle),
  )
}

function matchesFunction(fn: SchemaFunction, needle: string): boolean {
  return (
    needle === '' ||
    fn.signature.toLowerCase().includes(needle) ||
    (fn.comment ?? '').toLowerCase().includes(needle)
  )
}

function matchesSymbol(symbol: CodeSymbol, needle: string): boolean {
  return (
    symbol.name.toLowerCase().includes(needle) ||
    symbol.signature.toLowerCase().includes(needle) ||
    symbol.description.toLowerCase().includes(needle) ||
    `${symbol.package}/${symbol.module}`.toLowerCase().includes(needle)
  )
}

function firstSentence(text: string): string {
  const end = text.indexOf('. ')
  return end === -1 ? text : text.slice(0, end + 1)
}

function readableDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function readableBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
