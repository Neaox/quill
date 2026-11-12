import type { CodeIndexArtifactV1 } from './artifact.ts'
import type {
  SchemaFunctionV1,
  SchemaNamespaceV1,
  SchemaSnapshotV1,
  SchemaTableV1,
} from './schema/types.ts'

export interface CodeIndexReport {
  readonly artifact: CodeIndexArtifactV1
  readonly schema?: SchemaSnapshotV1
  readonly title?: string
}

interface ReportSymbol extends Omit<
  CodeIndexArtifactV1['files'][string]['symbols'][number],
  'tags'
> {
  readonly tags: readonly { readonly name: string; readonly text: string }[]
  readonly usedBy: readonly { readonly file: string; readonly line: number }[]
}

interface ReportPayload {
  readonly title: string
  readonly commit: string
  readonly repo: string
  readonly generatedAt: string
  readonly symbols: readonly ReportSymbol[]
  readonly tables: readonly SchemaTableV1[]
  readonly namespaces: readonly SchemaNamespaceV1[]
  readonly functions: readonly SchemaFunctionV1[]
  readonly comments: {
    readonly tables: number
    readonly columns: number
    readonly columnTotal: number
    readonly functions: number
  }
  readonly source: string
}

/**
 * One self-contained HTML report: code symbols and, when present, the schema.
 * No server, no fetch, no JavaScript framework. It is the first thing a person
 * can open before the hosted Quill surface exists.
 */
export function buildCodeIndexReport(report: CodeIndexReport): string {
  const usedBy = new Map<string, { file: string; line: number }[]>()
  const symbols: ReportSymbol[] = []
  for (const [file, record] of Object.entries(report.artifact.files)) {
    for (const usage of record.usages) {
      const list = usedBy.get(usage.to) ?? []
      list.push({ file, line: usage.line })
      usedBy.set(usage.to, list)
    }
    for (const symbol of record.symbols) {
      symbols.push({ ...symbol, usedBy: usedBy.get(symbol.moniker) ?? [] })
    }
  }

  const tables = (report.schema?.tables ?? []).toSorted(
    (left, right) => left.schema.localeCompare(right.schema) || left.name.localeCompare(right.name),
  )
  const functions = (report.schema?.functions ?? []).toSorted(
    (left, right) => left.schema.localeCompare(right.schema) || left.name.localeCompare(right.name),
  )
  const namespaceNames = new Set([
    ...tables.map((table) => table.schema),
    ...functions.map((fn) => fn.schema),
    ...(report.schema?.namespaces ?? []).map((namespace) => namespace.name),
  ])
  const namespaces = [...namespaceNames].toSorted().map((name) => {
    const known = report.schema?.namespaces?.find((namespace) => namespace.name === name)
    return known ?? { name }
  })

  const columnTotal = tables.reduce((sum, table) => sum + table.columns.length, 0)
  const comments = {
    tables: tables.filter((table) => table.comment !== undefined && table.comment !== '').length,
    columns: tables.reduce(
      (sum, table) =>
        sum +
        table.columns.filter((column) => column.comment !== undefined && column.comment !== '')
          .length,
      0,
    ),
    columnTotal,
    functions: functions.filter((fn) => fn.comment !== undefined && fn.comment !== '').length,
  }
  const payload: ReportPayload = {
    title: report.title ?? 'Code and schema index',
    commit: report.artifact.commit,
    repo: report.artifact.repo,
    generatedAt: report.artifact.generatedAt,
    symbols: symbols.toSorted((left, right) => left.moniker.localeCompare(right.moniker)),
    tables,
    namespaces,
    functions,
    comments,
    source: report.schema?.source ?? 'none',
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(payload.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="topbar">
  <div class="brand">
    <span class="brand-mark" aria-hidden="true">${ICONS.brand}</span>
    <div class="brand-copy">
      <h1>${escapeHtml(payload.title)}</h1>
      <p class="meta">${payload.symbols.length.toLocaleString()} symbols · ${payload.tables.length.toLocaleString()} tables · ${payload.functions.length.toLocaleString()} functions · ${payload.comments.tables.toLocaleString()}/${payload.tables.length.toLocaleString()} tables annotated · ${escapeHtml(payload.repo || 'unknown repository')} at <code>${escapeHtml(payload.commit.slice(0, 9))}</code> · generated ${escapeHtml(payload.generatedAt)}</p>
    </div>
  </div>
  <div class="tools">
    <label class="search" for="q">
      <span class="sr-only">Search code, tables, columns and functions</span>
      <span class="search-icon" aria-hidden="true">${ICONS.search}</span>
      <input id="q" type="search" placeholder="Search symbols, tables, columns, functions…" autocomplete="off">
    </label>
    <div class="mode" role="group" aria-label="Show">
      <button type="button" data-mode="all" aria-pressed="true">All</button>
      <button type="button" data-mode="code" aria-pressed="false">Code</button>
      <button type="button" data-mode="schema" aria-pressed="false">Schema</button>
    </div>
    <label class="toggle"><input id="local" type="checkbox" checked> Local helpers</label>
    <span id="count" class="count" role="status"></span>
  </div>
</header>
<div class="layout">
  <aside class="sidebar">
    <div class="sidebar-head">
      <h2>Schemas</h2>
      <span id="tree-count" class="count"></span>
    </div>
    <nav id="tree" class="tree" aria-label="Schema tree"></nav>
  </aside>
  <main id="main">
    <section id="code-section" aria-labelledby="code-heading">
      <div class="section-head">
        <h2 id="code-heading">Code</h2>
        <p class="hint">Signatures, doc comments and usages. Select a name to open it at the indexed commit.</p>
      </div>
      <div id="code" class="results"></div>
      <p id="code-more" class="more" hidden></p>
    </section>
    <section id="schema-section" aria-labelledby="schema-heading">
      <div class="section-head">
        <h2 id="schema-heading">Schema</h2>
        <p class="hint">${payload.tables.length === 0 ? 'No schema was supplied to this report.' : 'Structure only. No row values are read, stored or shown. ' + payload.comments.tables + ' of ' + payload.tables.length + ' tables, ' + payload.comments.columns + ' of ' + payload.comments.columnTotal + ' columns and ' + payload.comments.functions + ' of ' + payload.functions.length + ' functions carry a comment.'}</p>
      </div>
      <div id="schema" class="schema-list"></div>
    </section>
  </main>
</div>
<footer>
  <p>Generated by <strong>@quill/code-index</strong> from Markdown, source and migrations. This page reads nothing at open time.</p>
</footer>
<script type="application/json" id="data">${jsonForScript(payload)}</script>
<script>${SCRIPT}</script>
</body>
</html>
`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}

const ICONS = {
  brand: svg(
    '<path d="M4 3.5h7a3 3 0 0 1 3 3v1a2.5 2.5 0 0 0 2.5 2.5" />' +
      '<path d="M4 16.5h7a3 3 0 0 0 3-3v-1a2.5 2.5 0 0 1 2.5-2.5" />' +
      '<path d="M16.5 3.5H19M16.5 16.5H19" />',
  ),
  search:
    '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="9" cy="9" r="5.5"/><path d="m13.2 13.2 3.3 3.3"/></svg>',
  chevron:
    '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 5 5 5-5 5"/></svg>',
  function: svg(
    '<path d="M7 3.5c-1.8 0-2.8 1-2.8 2.8v1.4c0 1.4-.8 2.3-2.2 2.3 1.4 0 2.2.9 2.2 2.3v1.4c0 1.8 1 2.8 2.8 2.8" /><path d="M13 3.5c1.8 0 2.8 1 2.8 2.8v1.4c0 1.4.8 2.3 2.2 2.3-1.4 0-2.2.9-2.2 2.3v1.4c0 1.8-1 2.8-2.8 2.8" />',
  ),
  class: svg(
    '<path d="m10 2.8 6.3 3.6v7.2L10 17.2l-6.3-3.6V6.4L10 2.8Z" /><path d="M3.9 6.5 10 10l6.1-3.5M10 10v7" />',
  ),
  type: svg('<path d="M3 10 10 3l7 7-7 7-7-7Z" /><path d="M7.2 10h5.6M10 7.2v5.6" />'),
  const: svg('<circle cx="10" cy="10" r="6.2" /><path d="M10 6.8v6.4M6.8 10h6.4" />'),
  table: svg(
    '<rect x="3" y="3.5" width="14" height="13" rx="2" /><path d="M3 7.5h14M3 11.5h14M7.5 7.5v9" />',
  ),
  view: svg(
    '<path d="M2.5 10s2.7-5 7.5-5 7.5 5 7.5 5-2.7 5-7.5 5-7.5-5-7.5-5Z" /><circle cx="10" cy="10" r="2.2" />',
  ),
  column: svg('<path d="M6 3.5v13M14 3.5v13M3.5 3.5h13v13h-13z" />'),
  package: svg('<path d="m10 2.8 6.3 3.6v7.2L10 17.2l-6.3-3.6V6.4L10 2.8Z" />'),
  copy: svg(
    '<rect x="7" y="7" width="9" height="9" rx="1.5" /><path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" />',
  ),
} as const

function svg(paths: string): string {
  return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
}

const STYLE = `
:root{color-scheme:light dark;--header-h:72px;--bg:#fbfbfa;--surface:#fff;--surface-2:#f4f4f1;--fg:#1b1b19;--muted:#6d6d67;--faint:#8f8f88;--border:#e4e4df;--accent:#1f5fbf;--accent-soft:#eef4ff;--code-bg:#f3f3ef;--good:#1f7a4d;--good-soft:#e9f6ee;--bad:#a33a3a;--bad-soft:#fbeeee;--warn:#7a5a00;--warn-soft:#fff6d8;--radius:10px;--shadow:0 1px 2px rgba(20,20,18,.04),0 10px 30px rgba(20,20,18,.035)}
@media (prefers-color-scheme:dark){:root{--bg:#151514;--surface:#1d1d1b;--surface-2:#242421;--fg:#efefea;--muted:#a7a7a0;--faint:#7e7e77;--border:#32322e;--accent:#8ab8ff;--accent-soft:#1c2b43;--code-bg:#252522;--good:#75d3a3;--good-soft:#173226;--bad:#f0a3a3;--bad-soft:#3a1d1d;--warn:#f0d27a;--warn-soft:#352c12;--shadow:0 1px 2px rgba(0,0,0,.25),0 12px 30px rgba(0,0,0,.22)}}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:calc(var(--header-h,72px) + 16px)}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
code,pre,kbd{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}
a{color:var(--accent);text-underline-offset:2px}
.skip{position:absolute;left:-9999px;top:8px;background:var(--surface);padding:8px 12px;border:1px solid var(--border);border-radius:8px;z-index:10}
.skip:focus{left:16px}
.topbar{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(14px);border-bottom:1px solid var(--border)}
.topbar,.section-head,.results,footer,.more,.layout{padding-inline:24px}
.topbar{padding-block:14px;display:flex;flex-wrap:wrap;gap:14px 24px;align-items:center;justify-content:space-between}
.brand{display:flex;gap:12px;align-items:center;min-width:280px;flex:1 1 380px}
.brand-mark{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:var(--accent-soft);color:var(--accent);flex:0 0 auto}
.brand-mark svg{width:21px;height:21px}
.brand-copy{min-width:0}
h1{font-size:17px;line-height:1.25;margin:0;letter-spacing:-.01em}
.meta{margin:2px 0 0;color:var(--muted);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta code{background:none;padding:0;color:var(--fg);font-size:12px}
.tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.search{position:relative;display:flex;align-items:center;flex:1 1 340px;min-width:240px}
.search-icon{position:absolute;left:10px;display:grid;place-items:center;width:18px;height:18px;color:var(--faint);pointer-events:none}
.search-icon svg{width:18px;height:18px}
#q{width:100%;font:inherit;font-size:14px;padding:8px 10px 8px 34px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--fg);outline:none}
#q::placeholder{color:var(--faint)}
#q:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.mode{display:inline-flex;border:1px solid var(--border);border-radius:8px;background:var(--surface);padding:2px}
.mode button{font:inherit;font-size:12.5px;padding:4px 9px;border:0;border-radius:6px;background:transparent;color:var(--muted);cursor:pointer}
.mode button[aria-pressed="true"]{background:var(--accent-soft);color:var(--accent);font-weight:600}
.mode button:focus-visible,.toggle input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.toggle{font-size:12.5px;color:var(--muted);display:inline-flex;gap:6px;align-items:center;cursor:pointer}
.count{font-size:12.5px;color:var(--muted);white-space:nowrap}
.layout{max-width:1320px;margin-inline:auto;display:grid;grid-template-columns:280px minmax(0,1fr);gap:30px;align-items:start}
.sidebar{position:sticky;top:calc(var(--header-h,72px) + 16px);max-height:calc(100vh - var(--header-h,72px) - 32px);overflow:auto;padding:18px 0 24px;border-right:1px solid var(--border);z-index:1}
.sidebar-head{display:flex;align-items:baseline;justify-content:space-between;padding-right:18px;margin-bottom:8px}
.sidebar-head h2{font-size:11.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--faint);margin:0}
.tree{font-size:13px;padding-right:18px}
.tree details{margin:1px 0}
.tree summary{display:flex;align-items:center;gap:5px;padding:4px 5px;border-radius:5px;cursor:pointer;list-style:none;color:var(--fg)}
.tree summary::-webkit-details-marker{display:none}
.tree summary:hover{background:var(--surface-2)}
.tree summary:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.chevron{display:grid;place-items:center;width:14px;height:14px;color:var(--faint);flex:0 0 auto;transition:transform .15s ease}
.chevron svg{width:12px;height:12px}
details[open] > summary > .chevron{transform:rotate(90deg)}
.tree-name{font-weight:600;overflow-wrap:anywhere}
.tree-count{margin-left:auto;font-size:11px;color:var(--faint);background:var(--surface-2);border-radius:999px;padding:0 6px}
.tree-children{padding-left:16px}
.tree-link{display:block;padding:3px 5px;border-radius:5px;color:var(--muted);text-decoration:none;overflow-wrap:anywhere}
.tree-link:hover{background:var(--surface-2);color:var(--fg)}
.tree-link:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.tree-columns{padding-left:14px}
.tree-columns a{display:block;padding:2px 5px;font-size:12px;color:var(--faint);text-decoration:none;border-radius:4px;overflow-wrap:anywhere}
.tree-columns a:hover{background:var(--surface-2);color:var(--fg)}
.schema-list{max-width:980px}
.schema-block{padding:24px 0 8px;border-top:1px solid var(--border)}
.schema-block:first-child{border-top:0;padding-top:14px}
.schema-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 12px;margin-bottom:4px}
.schema-head h3{font-size:18px;letter-spacing:-.01em;margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.schema-head .kind-label{font-size:11px}
.schema-comment{margin:5px 0 12px;color:var(--muted);max-width:74ch}
.subhead{display:flex;align-items:baseline;gap:8px;margin:18px 0 6px;font-size:11.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--faint)}
.subhead span{background:var(--surface-2);border-radius:999px;padding:0 6px;font-size:11px}
.section-head{padding-top:30px;padding-bottom:10px}
.section-head h2{font-size:15px;letter-spacing:.02em;text-transform:uppercase;color:var(--muted);margin:0 0 3px}
.hint{margin:0;color:var(--faint);font-size:12.5px}
.results{display:grid;gap:10px}
article.card{border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);box-shadow:var(--shadow);padding:14px 16px;display:grid;grid-template-columns:26px minmax(0,1fr);gap:12px}
article.card:target{box-shadow:0 0 0 3px var(--accent-soft),var(--shadow);border-color:var(--accent)}
.kind{width:26px;height:26px;border-radius:7px;display:grid;place-items:center;background:var(--surface-2);color:var(--muted)}
.kind svg{width:16px;height:16px}
.kind.function,.kind.method{color:#7c3aed;background:#f3eefe}
.kind.class{color:#0f766e;background:#e7f7f4}
.kind.type,.kind.interface{color:#b45309;background:#fff4e2}
.kind.const,.kind.property{color:#1f5fbf;background:#eaf2ff}
.kind.table{color:#0f766e;background:#e7f7f4}
.kind.view{color:#7c3aed;background:#f3eefe}
@media (prefers-color-scheme:dark){.kind.function,.kind.method{color:#c4a7ff;background:#2a2140}.kind.class,.kind.table{color:#7ed9c6;background:#16312d}.kind.type,.kind.interface{color:#f2c27a;background:#332713}.kind.const,.kind.property{color:#9cc2ff;background:#1b2a44}.kind.view{color:#c4a7ff;background:#2a2140}}
.card-head{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:baseline;min-width:0}
.name{font-size:15px;font-weight:650;letter-spacing:-.01em;color:var(--fg);text-decoration:none;overflow-wrap:anywhere}
.name:hover{text-decoration:underline}
.kind-label{font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--faint)}
.path{font-size:12px;color:var(--muted);overflow-wrap:anywhere}
.path code{background:none;padding:0;color:inherit}
.copy{margin-left:auto;display:inline-flex;align-items:center;gap:4px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);color:var(--muted);font:inherit;font-size:11.5px;padding:2px 7px;cursor:pointer;opacity:0;transition:opacity .15s ease}
.copy svg{width:12px;height:12px}
article:hover .copy,.copy:focus-visible{opacity:1}
.copy:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.signature{margin:8px 0 0;padding:9px 11px;background:var(--code-bg);border:1px solid var(--border);border-radius:7px;font-size:12.5px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--fg)}
.type-full,.definition{margin:6px 0 0}.type-full summary,.definition summary{cursor:pointer;color:var(--muted);font-size:12px;width:fit-content}.type-full summary:focus-visible,.definition summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.definition pre{max-height:420px;overflow:auto}.schema-view{margin-top:8px}.schema-toggle{display:inline-flex;border:1px solid var(--border);border-radius:7px;background:var(--surface-2);padding:2px;margin-bottom:6px}.schema-toggle button{font:inherit;font-size:11.5px;padding:3px 8px;border:0;border-radius:5px;background:transparent;color:var(--muted);cursor:pointer}.schema-toggle button[aria-pressed="true"]{background:var(--surface);color:var(--accent);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.08)}.schema-toggle button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}.schema-panel[hidden]{display:none}
.description{margin:8px 0 0;color:var(--fg);max-width:78ch}
.empty-desc{margin:8px 0 0;color:var(--faint);font-style:italic}
.meta-row{margin:7px 0 0;color:var(--muted);font-size:12.5px}
.meta-row code{background:none;padding:0;color:var(--fg);font-size:12px}
.tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:9px}
.tag{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--border);border-radius:999px;padding:2px 8px;font-size:11.5px;color:var(--muted);background:var(--surface-2)}
.tag.key{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 25%,var(--border));background:var(--accent-soft)}
.tag.deprecated{color:var(--warn);background:var(--warn-soft);border-color:color-mix(in srgb,var(--warn) 25%,var(--border))}
.none{color:var(--faint);font-style:italic;padding:18px 0}
.more{color:var(--faint);font-size:12.5px;padding-top:12px}
table.data{border-collapse:collapse;width:100%;font-size:12.5px;margin-top:10px}
table.data th,table.data td{text-align:left;vertical-align:top;padding:6px 8px;border-bottom:1px solid var(--border)}
table.data th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);font-weight:600}
table.data td:first-child{font-weight:600;white-space:nowrap}
table.data tr:target{background:var(--accent-soft)}
table.data code{background:none;padding:0;color:var(--muted);font-size:12px}
.key-badge{display:inline-block;border-radius:5px;padding:1px 6px;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;margin-right:3px}
.key-badge.pk{background:var(--accent-soft);color:var(--accent)}
.key-badge.uq{background:var(--good-soft);color:var(--good)}
.key-badge.fk{background:var(--warn-soft);color:var(--warn)}
.fk-link,.type-ref{color:var(--accent)}.readable-type{margin-top:9px}.readable-type .kind-label{display:block;margin-bottom:3px}
.fn-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
footer{border-top:1px solid var(--border);margin-top:40px;padding-block:18px;color:var(--faint);font-size:12px;max-width:1320px;margin-inline:auto}
footer p{margin:0}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.tok-keyword{color:#7c3aed;font-weight:600}.tok-type{color:#0f766e}.tok-string{color:#b45309}.tok-number{color:#1f5fbf}.tok-comment{color:var(--faint);font-style:italic}.tok-punctuation{color:var(--muted)}
@media (prefers-color-scheme:dark){.tok-keyword{color:#c4a7ff}.tok-type{color:#7ed9c6}.tok-string{color:#f2c27a}.tok-number{color:#9cc2ff}}
@media (max-width:900px){.layout{display:block;padding-inline:14px}.sidebar{position:static;max-height:280px;border-right:0;border-bottom:1px solid var(--border);padding-bottom:12px}.sidebar-head{padding-right:0}.tree{padding-right:0}.topbar,.section-head,.results,footer,.more{padding-inline:14px}.brand{min-width:0;flex-basis:100%}.tools{width:100%}.search{flex-basis:100%}.count{width:100%}.brand-copy .meta{white-space:normal}}
@media (max-width:620px){.brand-copy .meta{font-size:11.5px}.results,.schema-list{max-width:none}article.card{grid-template-columns:22px minmax(0,1fr);padding:12px}.kind{width:22px;height:22px}.signature{font-size:12px}.schema-head h3{font-size:16px}.copy{opacity:1}}
@media print{.topbar{position:static;backdrop-filter:none}.tools,.sidebar,.copy{display:none}.layout{display:block}article.card{break-inside:avoid;box-shadow:none}footer{display:none}}
`

const SCRIPT = `
const data = JSON.parse(document.getElementById("data").textContent);
const header = document.querySelector(".topbar");
function syncHeaderHeight() { document.documentElement.style.setProperty("--header-h", header.getBoundingClientRect().height + "px"); }
syncHeaderHeight();
if (typeof ResizeObserver !== "undefined") new ResizeObserver(syncHeaderHeight).observe(header);
window.addEventListener("resize", syncHeaderHeight);
const SYMBOL_TYPE_KINDS = new Set(["type", "interface", "class", "enum"]);
const typeUsage = new Map();
for (const symbol of data.symbols) for (const ref of symbol.typeRefs || []) if (ref.moniker) { const list = typeUsage.get(ref.moniker) || []; list.push(symbol); typeUsage.set(ref.moniker, list); }
const q = document.getElementById("q"), local = document.getElementById("local");
const count = document.getElementById("count"), treeCount = document.getElementById("tree-count");
const code = document.getElementById("code"), schemaList = document.getElementById("schema");
const codeSection = document.getElementById("code-section"), schemaSection = document.getElementById("schema-section");
const codeMore = document.getElementById("code-more"), tree = document.getElementById("tree");
let mode = "all";
const KEYWORDS = new Set(["abstract","as","async","await","break","case","catch","class","const","constructor","continue","declare","default","delete","do","else","enum","export","extends","false","finally","for","from","function","get","if","implements","import","in","infer","instanceof","interface","keyof","let","new","null","of","private","protected","public","readonly","return","set","static","super","switch","this","throw","true","try","type","typeof","undefined","unique","unknown","var","void","while","yield"]);
const TYPES = new Set(["any","bigint","boolean","never","number","object","string","symbol","unknown","void","Array","Date","Error","Map","Promise","Readonly","Record","Set","Temporal"]);
const TOKEN = /("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|\\b(\\d+(?:\\.\\d+)?)\\b|\\b([A-Za-z_$][\\w$]*)\\b|([{}()\\[\\],:;<>|=?&*+\\-/.]+)/g;
function escapeHtml(value) { return value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;"); }
function highlight(text) {
  let out = "", last = 0;
  for (const match of text.matchAll(TOKEN)) {
    out += escapeHtml(text.slice(last, match.index));
    const token = match[0];
    const cls = match[1] ? "string" : match[2] ? "number" : match[3] ? (KEYWORDS.has(token) ? "keyword" : TYPES.has(token) ? "type" : "") : "punctuation";
    out += cls ? '<span class="tok-' + cls + '">' + escapeHtml(token) + "</span>" : escapeHtml(token);
    last = match.index + token.length;
  }
  return out + escapeHtml(text.slice(last));
}
function compact(value, max = 220) {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const boundary = Math.max(cut.lastIndexOf(";"), cut.lastIndexOf(","), cut.lastIndexOf(" "));
  return (boundary > 40 ? cut.slice(0, boundary) : cut).trimEnd() + " …";
}
function el(tag, props, ...kids) { const e = document.createElement(tag); Object.assign(e, props || {}); for (const k of kids) e.append(k); return e; }
function idFor(...parts) { return parts.join("-").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/-+/g, "-"); }
function icon(kind) { const span = el("span", { className: "kind " + kind }); span.innerHTML = ICONS[kind] || ICONS.package; return span; }
function label(kind) { return kind === "function" ? "Function" : kind === "method" ? "Method" : kind === "class" ? "Class" : kind === "interface" ? "Interface" : kind === "type" ? "Type" : kind === "const" ? "Constant" : kind === "property" ? "Property" : kind === "table" ? "Table" : kind === "view" ? "View" : kind; }
function copyButton(text) { const button = el("button", { className: "copy", type: "button", "aria-label": "Copy " + text, "data-copy": text }); button.innerHTML = ICONS.copy + "<span>Copy</span>"; return button; }
function sourceLink(symbol) { if (!data.repo || !symbol.file) return el("span", { className: "name", textContent: symbol.name }); return el("a", { className: "name", href: "https://github.com/" + data.repo + "/blob/" + data.commit + "/" + symbol.file + "#L" + symbol.startLine + "-L" + symbol.endLine, target: "_blank", rel: "noreferrer", textContent: symbol.name }); }
function prettyType(value) {
  if (!value.startsWith("{") || !value.endsWith("}")) return value;
  let out = "", depth = 0, skipSpace = false;
  for (const character of value) {
    if (skipSpace && character === " ") { skipSpace = false; continue; }
    skipSpace = false;
    if (character === "{") { depth += 1; out += "{\\n" + "  ".repeat(depth); skipSpace = true; }
    else if (character === "}") { depth -= 1; out += "\\n" + "  ".repeat(depth) + "}"; }
    else if (character === ";") { out += ";\\n" + "  ".repeat(depth); skipSpace = true; }
    else out += character;
  }
  return out;
}
function codePanel(text) {
  const panel = el("div", { className: "schema-panel" });
  const pre = el("pre", { className: "signature" }); pre.innerHTML = highlight(compact(text)); panel.append(pre);
  if (compact(text) !== text) {
    const full = el("details", { className: "type-full" }); full.append(el("summary", { textContent: "Show full" }));
    const raw = el("pre", { className: "signature" }); raw.innerHTML = highlight(text); full.append(raw); panel.append(full);
  }
  return panel;
}
function schemaView(symbol) {
  const view = el("div", { className: "schema-view" });
  const inferredName = symbol.schemaRef ? symbol.name : symbol.inferredTypeRef?.name || symbol.name;
  const inferred = "type " + inferredName + " = " + prettyType(symbol.readableType) + ";";
  const source = symbol.definition || symbol.signature;
  const alias = Boolean(symbol.schemaRef);
  const sourcePanel = codePanel(source);
  const inferredPanel = codePanel(inferred);
  const sourceButton = el("button", { type: "button", "aria-pressed": String(!alias), textContent: alias ? "Source" : "Schema" });
  const inferredButton = el("button", { type: "button", "aria-pressed": String(alias), textContent: "Inferred" });
  const controls = el("div", { className: "schema-toggle", role: "group", "aria-label": "Type view" }, sourceButton, inferredButton);
  const show = (value) => {
    sourcePanel.hidden = value;
    inferredPanel.hidden = !value;
    sourceButton.setAttribute("aria-pressed", String(!value));
    inferredButton.setAttribute("aria-pressed", String(value));
  };
  sourceButton.addEventListener("click", () => show(false));
  inferredButton.addEventListener("click", () => show(true));
  view.append(controls, sourcePanel, inferredPanel);
  show(alias);
  return view;
}
function symbolCard(symbol) {
  const card = el("article", { className: "card", id: "symbol-" + idFor(symbol.moniker) });
  card.append(icon(symbol.kind));
  const body = el("div");
  const head = el("div", { className: "card-head" }, sourceLink(symbol), el("span", { className: "kind-label", textContent: label(symbol.kind) }), el("span", { className: "path" }, el("code", { textContent: symbol.package + "/" + symbol.module })), copyButton(symbol.name));
  body.append(head);
  if (symbol.readableType) {
    body.append(schemaView(symbol));
  } else {
    const declarationFirst = symbol.definition && (symbol.kind === "const" || symbol.kind === "type" || symbol.kind === "interface" || symbol.kind === "class");
    const primary = declarationFirst ? symbol.definition : symbol.signature;
    const displayed = compact(primary);
    const primaryBlock = el("pre", { className: "signature" }); primaryBlock.innerHTML = highlight(displayed); body.append(primaryBlock);
    if (displayed !== primary) {
      const full = el("details", { className: "type-full" });
      full.append(el("summary", { textContent: symbol.kind === "const" ? "Show full declaration" : "Show full signature" }));
      const pre = el("pre", { className: "signature" }); pre.innerHTML = highlight(primary); full.append(pre);
      body.append(full);
    }
  }
  if (symbol.inferredTypeRef) {
    body.append(el("p", { className: "meta-row" }, "Named type: ", el("a", { className: "type-ref", href: "#symbol-" + idFor(symbol.inferredTypeRef.moniker || symbol.inferredTypeRef.name), textContent: symbol.inferredTypeRef.name })));
  }
  if (symbol.schemaRef) {
    body.append(el("p", { className: "meta-row" }, "Defined from: ", el("a", { className: "type-ref", href: "#symbol-" + idFor(symbol.schemaRef.moniker || symbol.schemaRef.name), textContent: symbol.schemaRef.name })));
  }
  body.append(symbol.description ? el("p", { className: "description", textContent: symbol.description }) : el("p", { className: "empty-desc", textContent: "No description in the code." }));
  if (symbol.value) body.append(el("p", { className: "meta-row", textContent: "Value: " + symbol.value }));
  if (symbol.params.length) body.append(el("p", { className: "meta-row", textContent: "Parameters: " + symbol.params.map((p) => p.name + ": " + compact(p.type, 90) + (p.optional ? "?" : "")).join(" · ") }));
  if (symbol.returnType && (symbol.kind === "function" || symbol.kind === "method" || symbol.kind === "constructor")) {
    body.append(el("p", { className: "meta-row", textContent: "Returns: " + compact(symbol.returnType, 90) }));
    if (compact(symbol.returnType, 90) !== symbol.returnType) {
      const full = el("details", { className: "type-full" }); full.append(el("summary", { textContent: "Full return type" }));
      const pre = el("pre", { className: "signature" }); pre.innerHTML = highlight(symbol.returnType); full.append(pre); body.append(full);
    }
  }
  if (symbol.typeRefs && symbol.typeRefs.length) {
    const row = el("p", { className: "meta-row" }); row.append("Types: ");
    symbol.typeRefs.forEach((ref, index) => {
      if (index) row.append(" · ");
      if (ref.moniker) row.append(el("a", { className: "type-ref", href: "#symbol-" + idFor(ref.moniker), textContent: ref.name }));
      else row.append(el("span", { textContent: ref.name }));
    });
    body.append(row);
  }
  if ((symbol.kind === "type" || symbol.kind === "interface" || symbol.kind === "class" || symbol.kind === "enum") && typeUsage.has(symbol.moniker)) {
    const users = typeUsage.get(symbol.moniker);
    const row = el("p", { className: "meta-row" }); row.append("Used by " + users.length + " symbol" + (users.length === 1 ? "" : "s") + ": ");
    users.slice(0, 8).forEach((user, index) => { if (index) row.append(" · "); row.append(el("a", { className: "type-ref", href: "#symbol-" + idFor(user.moniker), textContent: user.name })); });
    if (users.length > 8) row.append(" · …");
    body.append(row);
  }
  const tags = [...symbol.concepts.map((c) => ({ text: c, className: "key" })), ...symbol.keywords.map((c) => ({ text: c, className: "" })), ...symbol.tags.filter((t) => t.name !== "keywords" && t.name !== "concept").map((t) => ({ text: "@" + t.name + (t.text ? " " + t.text : ""), className: t.name === "deprecated" ? "deprecated" : "" }))];
  if (tags.length) { const row = el("div", { className: "tags" }); for (const tag of tags) row.append(el("span", { className: "tag " + tag.className, textContent: tag.text })); body.append(row); }
  if (symbol.usedBy.length) body.append(el("p", { className: "meta-row", textContent: "Used " + symbol.usedBy.length + " time" + (symbol.usedBy.length === 1 ? "" : "s") + " in " + new Set(symbol.usedBy.map((u) => u.file)).size + " file" + (new Set(symbol.usedBy.map((u) => u.file)).size === 1 ? "" : "s") }));
  card.append(body);
  return card;
}
function tableId(table) { return "table-" + idFor(table.schema, table.name); }
function columnId(table, column) { return "column-" + idFor(table.schema, table.name, column.name); }
function tableCard(table, incoming) {
  const card = el("article", { className: "card", id: tableId(table) });
  card.append(icon(table.kind));
  const body = el("div");
  const head = el("div", { className: "card-head" }, el("span", { className: "name", textContent: table.schema + "." + table.name }), el("span", { className: "kind-label", textContent: label(table.kind) }), copyButton(table.schema + "." + table.name));
  body.append(head);
  if (table.comment) body.append(el("p", { className: "description", textContent: table.comment }));
  else body.append(el("p", { className: "empty-desc", textContent: "No comment on the table." }));
  const dataTable = el("table", { className: "data" });
  const headRow = el("tr", {}, el("th", { scope: "col", textContent: "Column" }), el("th", { scope: "col", textContent: "Type" }), el("th", { scope: "col", textContent: "Nullable" }), el("th", { scope: "col", textContent: "Default" }), el("th", { scope: "col", textContent: "Key" }), el("th", { scope: "col", textContent: "Comment" }));
  dataTable.append(el("thead", {}, headRow));
  const tbody = el("tbody");
  for (const column of table.columns) {
    const key = el("td");
    if (column.primaryKey) key.append(el("span", { className: "key-badge pk", textContent: "PK" }));
    if (column.unique) key.append(el("span", { className: "key-badge uq", textContent: "Unique" }));
    if (column.references) {
      const targetSchema = column.references.schema || table.schema;
      const target = document.createElement("a");
      target.className = "key-badge fk fk-link";
      target.href = "#" + tableId({ schema: targetSchema, name: column.references.table });
      target.textContent = "FK → " + targetSchema + "." + column.references.table;
      key.append(target);
    }
    const comment = el("td", { textContent: column.comment || "—" });
    tbody.append(el("tr", { id: columnId(table, column) }, el("td", { textContent: column.name }), el("td", {}, el("code", { textContent: column.type })), el("td", { textContent: column.nullable ? "yes" : "no" }), el("td", { textContent: column.default || "—" }), key, comment));
  }
  dataTable.append(tbody);
  body.append(dataTable);
  if (incoming.length) {
    body.append(el("p", { className: "meta-row", textContent: "Referenced by: " + incoming.map((ref) => ref.from.schema + "." + ref.from.name + " (" + ref.columns.join(", ") + ")").join(" · ") }));
  }
  card.append(body);
  return card;
}
function functionCard(fn) {
  const card = el("article", { className: "card", id: "function-" + idFor(fn.schema, fn.name) });
  card.append(icon("function"));
  const body = el("div");
  body.append(el("div", { className: "card-head" }, el("span", { className: "name", textContent: fn.schema + "." + fn.name }), el("span", { className: "kind-label", textContent: "Function" }), copyButton(fn.signature)));
  const signature = el("pre", { className: "signature" }); signature.innerHTML = highlight(fn.signature); body.append(signature);
  body.append(fn.comment ? el("p", { className: "description", textContent: fn.comment }) : el("p", { className: "empty-desc", textContent: "No comment on the function." }));
  const meta = el("div", { className: "fn-meta" });
  if (fn.returns) meta.append(el("span", { className: "tag", textContent: "returns " + fn.returns }));
  if (fn.language) meta.append(el("span", { className: "tag", textContent: fn.language }));
  if (fn.volatility) meta.append(el("span", { className: "tag", textContent: fn.volatility }));
  if (fn.securityDefiner) meta.append(el("span", { className: "tag deprecated", textContent: "security definer" }));
  if (meta.childElementCount) body.append(meta);
  card.append(body);
  return card;
}
function textOf(value) { return (value || "").toLowerCase(); }
function symbolMatches(symbol, query) {
  if (!query) return true;
  const text = textOf(symbol.name) + " " + textOf(symbol.package) + " " + textOf(symbol.module) + " " + textOf(symbol.signature) + " " + textOf(symbol.definition) + " " + textOf(symbol.readableType) + " " + textOf((symbol.typeRefs || []).map((ref) => ref.name).join(" ")) + " " + textOf(symbol.description) + " " + symbol.tags.map((t) => textOf(t.name) + " " + textOf(t.text)).join(" ") + " " + symbol.keywords.join(" ") + " " + symbol.concepts.join(" ");
  return text.includes(query);
}
function symbolScore(symbol, rawQuery, query) {
  if (!query) return 0;
  if (symbol.name === rawQuery) return 0;
  const name = textOf(symbol.name);
  if (name === query) return SYMBOL_TYPE_KINDS.has(symbol.kind) ? 1 : 2;
  if (name.startsWith(query)) return 3;
  if (textOf(symbol.package + "/" + symbol.module).includes(query)) return 4;
  if (textOf(symbol.signature).includes(query)) return 5;
  return 6;
}
function tableMatches(table, query) {
  if (!query) return true;
  const text = textOf(table.schema) + " " + textOf(table.name) + " " + textOf(table.comment) + " " + table.columns.map((c) => textOf(c.name) + " " + textOf(c.type) + " " + textOf(c.comment)).join(" ");
  return text.includes(query);
}
function functionMatches(fn, query) {
  if (!query) return true;
  return (textOf(fn.schema) + " " + textOf(fn.name) + " " + textOf(fn.signature) + " " + textOf(fn.comment)).includes(query);
}
function incomingFor(table) {
  const result = [];
  for (const source of data.tables) for (const fk of source.foreignKeys) {
    const target = fk.references.schema || source.schema;
    if (target === table.schema && fk.references.table === table.name) result.push({ from: source, columns: fk.columns });
  }
  return result;
}
function buildTree(query) {
  const groups = [];
  let shown = 0;
  for (const namespace of data.namespaces) {
    const tables = data.tables.filter((table) => table.schema === namespace.name && tableMatches(table, query));
    const functions = data.functions.filter((fn) => fn.schema === namespace.name && functionMatches(fn, query));
    if (!tables.length && !functions.length && query) continue;
    const details = el("details", { className: "tree-schema", open: true });
    details.append(el("summary", {}, el("span", { className: "chevron", innerHTML: ICONS.chevron }), el("span", { className: "tree-name", textContent: namespace.name }), el("span", { className: "tree-count", textContent: String(tables.length + functions.length) })));
    const children = el("div", { className: "tree-children" });
    for (const table of tables) {
      const item = el("details", { className: "tree-table" });
      item.append(el("summary", {}, el("span", { className: "chevron", innerHTML: ICONS.chevron }), el("a", { className: "tree-link", href: "#" + tableId(table), textContent: table.name })));
      const columns = el("div", { className: "tree-columns" });
      for (const column of table.columns) columns.append(el("a", { href: "#" + columnId(table, column), textContent: column.name }));
      if (table.columns.length) item.append(columns);
      children.append(item);
    }
    for (const fn of functions) children.append(el("a", { className: "tree-link", href: "#function-" + idFor(fn.schema, fn.name), textContent: fn.name + "()" }));
    details.append(children);
    groups.push(details);
    shown += tables.length + functions.length;
  }
  tree.replaceChildren(...groups);
  treeCount.textContent = shown.toLocaleString();
}
function renderSchema(query) {
  const groups = [];
  for (const namespace of data.namespaces) {
    const tables = data.tables.filter((table) => table.schema === namespace.name && tableMatches(table, query));
    const functions = data.functions.filter((fn) => fn.schema === namespace.name && functionMatches(fn, query));
    if (!tables.length && !functions.length && query) continue;
    const block = el("section", { className: "schema-block", id: "schema-" + idFor(namespace.name) });
    const head = el("div", { className: "schema-head" }, el("h3", { textContent: namespace.name }), el("span", { className: "kind-label", textContent: "Schema" }));
    block.append(head);
    if (namespace.comment) block.append(el("p", { className: "schema-comment", textContent: namespace.comment }));
    if (tables.length) {
      block.append(el("div", { className: "subhead" }, "Tables ", el("span", { textContent: String(tables.length) })));
      const list = el("div", { className: "results" });
      for (const table of tables) list.append(tableCard(table, incomingFor(table)));
      block.append(list);
    }
    if (functions.length) {
      block.append(el("div", { className: "subhead" }, "Functions ", el("span", { textContent: String(functions.length) })));
      const list = el("div", { className: "results" });
      for (const fn of functions) list.append(functionCard(fn));
      block.append(list);
    }
    groups.push(block);
  }
  schemaList.replaceChildren(...(groups.length ? groups : [el("p", { className: "none", textContent: "No schema matched." })]));
}
function setMode(next) { mode = next; for (const button of document.querySelectorAll(".mode button")) button.setAttribute("aria-pressed", String(button.dataset.mode === mode)); render(); }
function render() {
  const rawQuery = q.value.trim();
  const query = rawQuery.toLowerCase();
  const allSymbols = data.symbols.filter((symbol) => local.checked || symbol.visibility !== "local");
  const found = allSymbols
    .filter((symbol) => symbolMatches(symbol, query))
    .toSorted((left, right) => symbolScore(left, rawQuery, query) - symbolScore(right, rawQuery, query) || left.moniker.localeCompare(right.moniker));
  const showCode = mode !== "schema", showSchema = mode !== "code";
  codeSection.hidden = !showCode; schemaSection.hidden = !showSchema;
  count.textContent = found.length.toLocaleString() + " symbols · " + data.tables.length.toLocaleString() + " tables · " + data.functions.length.toLocaleString() + " functions";
  code.replaceChildren(...(found.length ? found.slice(0, 300).map(symbolCard) : [el("p", { className: "none", textContent: "No code matched. Try a name, a package, a type, or a word from a doc comment." })]));
  codeMore.hidden = found.length <= 300; codeMore.textContent = found.length > 300 ? "Showing the first 300 of " + found.length.toLocaleString() + " matches. Narrow the search." : "";
  buildTree(query);
  renderSchema(query);
}
document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy]");
  if (!button) return;
  event.preventDefault();
  try { await navigator.clipboard.writeText(button.dataset.copy); button.querySelector("span").textContent = "Copied"; setTimeout(() => { button.querySelector("span").textContent = "Copy"; }, 1500); } catch { button.querySelector("span").textContent = "Press Ctrl+C"; }
});
q.addEventListener("input", render);
local.addEventListener("change", render);
tree.addEventListener("click", (event) => {
  const link = event.target.closest("a[href^='#']");
  if (!link) return;
  if (mode === "code") setMode("all");
});
for (const button of document.querySelectorAll(".mode button")) button.addEventListener("click", () => setMode(button.dataset.mode));
const ICONS = ${jsonForScript(ICONS)};
render();
`
