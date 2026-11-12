import type { CodeIndexArtifactV1 } from './artifact.ts'
import type { SchemaSnapshotV1 } from './schema/types.ts'

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
  readonly tables: readonly SchemaSnapshotV1['tables'][number][]
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

  const payload: ReportPayload = {
    title: report.title ?? 'Code and schema index',
    commit: report.artifact.commit,
    repo: report.artifact.repo,
    generatedAt: report.artifact.generatedAt,
    symbols: symbols.toSorted((left, right) => left.moniker.localeCompare(right.moniker)),
    tables: (report.schema?.tables ?? []).toSorted(
      (left, right) =>
        left.schema.localeCompare(right.schema) || left.name.localeCompare(right.name),
    ),
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
<header>
  <h1>${escapeHtml(payload.title)}</h1>
  <p class="meta">${payload.symbols.length} symbols · ${payload.tables.length} tables · ${escapeHtml(payload.repo || 'unknown repository')} at <code>${escapeHtml(payload.commit.slice(0, 9))}</code> · generated ${escapeHtml(payload.generatedAt)}</p>
  <label for="q">Search code, tables and columns</label>
  <input id="q" type="search" placeholder="capture, payments.intents, uuid, description…" autofocus>
  <span id="count" role="status"></span>
</header>
<main>
  <section aria-labelledby="code-heading">
    <h2 id="code-heading">Code</h2>
    <div id="code"></div>
  </section>
  <section aria-labelledby="schema-heading">
    <h2 id="schema-heading">Schema</h2>
    <p class="meta">${payload.tables.length === 0 ? 'No schema was supplied to this report.' : 'Structure only: no row values are read.'}</p>
    <div id="schema"></div>
  </section>
</main>
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

const STYLE = `
:root{color-scheme:light dark;--fg:#1c1c1e;--bg:#fff;--dim:#6b6b70;--line:#d9d9de;--code:#f3f3f5;--accent:#0b5cad;--warn:#fff3cd;--warnfg:#664d03}
@media (prefers-color-scheme:dark){:root{--fg:#ececf0;--bg:#18181b;--dim:#9a9aa2;--line:#35353b;--code:#25252a;--accent:#7cb8ff;--warn:#3d3200;--warnfg:#ffe69c}}
*{box-sizing:border-box}body{margin:0;font:15px/1.45 system-ui,sans-serif;color:var(--fg);background:var(--bg)}
header{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:14px 18px;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}
h1{font-size:18px;margin:0 100% 0 0}h2{font-size:16px;margin:28px 0 8px}main{max-width:1100px;padding:0 18px 48px}
.meta{color:var(--dim);font-size:13px;margin:0}label{font-size:13px;color:var(--dim)}
#q{flex:1 1 420px;font:inherit;padding:7px 10px;border:1px solid var(--line);border-radius:5px;background:var(--bg);color:var(--fg)}
#count{font-size:13px;color:var(--dim)}
article{border-bottom:1px solid var(--line);padding:12px 0}
h3{font-size:15px;margin:0 0 2px}h3 a{color:var(--accent)}code{background:var(--code);padding:1px 4px;border-radius:3px;font-size:13px;word-break:break-word}
.tag{display:inline-block;border:1px solid var(--line);border-radius:10px;padding:0 7px;margin:3px 4px 0 0;font-size:12px;color:var(--dim)}
.none{color:var(--dim);font-style:italic}table{border-collapse:collapse;width:100%;font-size:13px;margin:8px 0 16px}
th,td{text-align:left;border-bottom:1px solid var(--line);padding:5px 7px;vertical-align:top}th{font-weight:600}
.empty{color:var(--dim);font-style:italic;padding:8px 0}
@media (max-width:640px){th,td{padding:4px}table{display:block;overflow-x:auto}}
`

const SCRIPT = `
const data = JSON.parse(document.getElementById("data").textContent);
const q = document.getElementById("q"), count = document.getElementById("count");
const code = document.getElementById("code"), schema = document.getElementById("schema");
function el(tag, props, ...kids) { const e = document.createElement(tag); Object.assign(e, props || {}); for (const k of kids) e.append(k); return e; }
function link(symbol) {
  if (!data.repo || !symbol.file) return el("span", { textContent: symbol.name });
  return el("a", { href: "https://github.com/" + data.repo + "/blob/" + data.commit + "/" + symbol.file + "#L" + symbol.startLine + "-L" + symbol.endLine, target: "_blank", rel: "noreferrer", textContent: symbol.name });
}
function textOf(value) { return (value || "").toLowerCase(); }
function symbolMatches(symbol, query) {
  if (!query) return true;
  const text = textOf(symbol.name) + " " + textOf(symbol.package) + " " + textOf(symbol.module) + " " + textOf(symbol.signature) + " " + textOf(symbol.description) + " " + symbol.tags.map((t) => textOf(t.name) + " " + textOf(t.text)).join(" ") + " " + symbol.keywords.join(" ") + " " + symbol.concepts.join(" ");
  return text.includes(query);
}
function tableMatches(table, query) {
  if (!query) return true;
  const text = textOf(table.schema) + " " + textOf(table.name) + " " + table.columns.map((c) => textOf(c.name) + " " + textOf(c.type)).join(" ");
  return text.includes(query);
}
function showSymbol(symbol) {
  const article = el("article");
  article.append(el("h3", {}, link(symbol), el("span", { className: "meta", textContent: " " + symbol.kind + " · " + symbol.package + "/" + symbol.module })));
  article.append(el("div", {}, el("code", { textContent: symbol.signature })));
  article.append(symbol.description ? el("p", { textContent: symbol.description }) : el("p", { className: "none", textContent: "No description in the code." }));
  if (symbol.params.length) article.append(el("p", { className: "meta", textContent: "Parameters: " + symbol.params.map((p) => p.name + ": " + p.type + (p.optional ? "?" : "")).join(", ") }));
  if (symbol.returnType && symbol.kind !== "type") article.append(el("p", { className: "meta", textContent: "Returns: " + symbol.returnType }));
  const tags = [...symbol.concepts.map((c) => "concept " + c), ...symbol.keywords, ...symbol.tags.filter((t) => t.name !== "keywords" && t.name !== "concept").map((t) => "@" + t.name + (t.text ? " " + t.text : ""))];
  if (tags.length) article.append(el("div", {}, ...tags.map((t) => el("span", { className: "tag", textContent: t }))));
  if (symbol.usedBy.length) article.append(el("p", { className: "meta", textContent: "Used " + symbol.usedBy.length + " time" + (symbol.usedBy.length === 1 ? "" : "s") + " in " + new Set(symbol.usedBy.map((u) => u.file)).size + " file" + (new Set(symbol.usedBy.map((u) => u.file)).size === 1 ? "" : "s") + "." }));
  return article;
}
function showTable(table) {
  const article = el("article");
  article.append(el("h3", { textContent: table.schema + "." + table.name + " " + (table.kind === "view" ? "(view)" : "") }));
  if (table.comment) article.append(el("p", { textContent: table.comment }));
  const tableEl = el("table");
  const head = el("tr", {}, el("th", { scope: "col", textContent: "Column" }), el("th", { scope: "col", textContent: "Type" }), el("th", { scope: "col", textContent: "Nullable" }), el("th", { scope: "col", textContent: "Default" }), el("th", { scope: "col", textContent: "Key" }));
  tableEl.append(el("thead", {}, head));
  const body = el("tbody");
  for (const column of table.columns) {
    const key = [column.primaryKey ? "PK" : "", column.unique ? "unique" : "", column.references ? "→ " + column.references.table : ""].filter(Boolean).join(", ");
    body.append(el("tr", {}, el("td", { textContent: column.name }), el("td", { textContent: column.type }), el("td", { textContent: column.nullable ? "yes" : "no" }), el("td", { textContent: column.default || "" }), el("td", { textContent: key })));
  }
  tableEl.append(body);
  article.append(tableEl);
  return article;
}
function render() {
  const query = q.value.trim().toLowerCase();
  const found = data.symbols.filter((symbol) => symbolMatches(symbol, query));
  const tables = data.tables.filter((table) => tableMatches(table, query));
  count.textContent = found.length + " symbols · " + tables.length + " tables";
  code.replaceChildren(...(found.length ? found.slice(0, 300).map(showSymbol) : [el("p", { className: "empty", textContent: "No code matched. Try a name, a package, a type, or a word from a doc comment." })]));
  schema.replaceChildren(...(tables.length ? tables.map(showTable) : [el("p", { className: "empty", textContent: "No table matched." })]));
}
q.addEventListener("input", render);
render();
`
