/**
 * Writes `apps/web/src/features/design/table-specimens.gen.ts`: the design
 * page's table specimens (ADR-040), each a piece of Markdown and the HTML
 * this package renders it to, so the showcase shows exactly what a reader
 * gets and cannot drift from the renderer.
 *
 * Usage: `pnpm --filter @quill/markdown generate:table-specimens`, after any
 * change to how tables render. ADR-040 makes the showcase part of done.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { parseDocument } from '../src/pipeline/parse-document.ts'
import { renderHtml } from '../src/render/html.ts'

interface Specimen {
  readonly id: string
  readonly label: string
  readonly note: string
  readonly markdown: string
}

const REGIONS = ['eu-west-1', 'us-east-1', 'ap-south-1', 'sa-east-1', 'eu-central-1', 'us-west-2']
const OWNERS = ['Platform', 'Data', 'Payments', 'Identity', 'Edge']

/** A long, wide table: forty rows, enough to scroll past the bar and sideways. */
function longTable(): string {
  const head =
    '| Service | Region | Owner | Budget | Requests per day | Error rate | Reviewed | Notes |'
  const rule = '| - | - | - | - | - | - | - | - |'
  const rows = Array.from({ length: 40 }, (_, index) => {
    const region = REGIONS[index % REGIONS.length] ?? ''
    const owner = OWNERS[index % OWNERS.length] ?? ''
    const month = String((index % 9) + 1).padStart(2, '0')
    const day = String((index % 27) + 1).padStart(2, '0')
    return `| Service ${index + 1} | ${region} | ${owner} | ${((index * 37) % 380) + 20} ms | ${(((index * 7919) % 90_000) + 1000).toLocaleString('en')} | ${(((index * 13) % 50) / 10).toFixed(1)}% | 2026-${month}-${day} | Routes traffic for ${region} and fails over to its pair |`
  })
  return [head, rule, ...rows].join('\n')
}

/** Five teams over twelve quarters: wider than any column, so it scrolls sideways. */
function quarters(): string {
  const names = Array.from({ length: 12 }, (_, i) => `Q${(i % 4) + 1} ${2025 + Math.floor(i / 4)}`)
  const rows = OWNERS.map(
    (owner, row) =>
      `| ${owner} | ${names.map((_, column) => String((((row + 1) * (column + 3) * 41) % 997) + 3)).join(' | ')} |`,
  )
  return [
    `| Team | ${names.join(' | ')} |`,
    `| - | ${names.map(() => '-').join(' | ')} |`,
    ...rows,
  ].join('\n')
}

const SMALL = `| Region | Owner | Budget |
| - | - | - |
| eu-west-1 | Platform | 120 ms |
| us-east-1 | Data | 90 ms |`

const SPECIMENS: readonly Specimen[] = [
  {
    id: 'widths',
    label: 'Widths',
    note: 'content, wide (the default), full, and 60% of the full track; switch the alignment above',
    markdown: [
      `:::table[At the reading measure]{width=content}\n${SMALL}\n:::`,
      `:::table[Wide, the default for a table]\n${SMALL}\n:::`,
      `:::table[The full track]{width=full}\n${SMALL}\n:::`,
      `:::table[Sixty per cent of the full track]{width=60%}\n${SMALL}\n:::`,
    ].join('\n\n'),
  },
  {
    id: 'columns',
    label: 'Proportional columns',
    note: 'columns="1fr 3fr 1fr": shares, never pixels, so they hold on any screen',
    markdown: `:::table{columns="1fr 3fr 1fr"}
| Service | What it does | Latency |
| - | - | - |
| Gateway | Routes every request to its region and retries once on failure | 12 ms |
| Ledger | Records each booking exactly once | 40 ms |
:::`,
  },
  {
    id: 'caption',
    label: 'A caption above',
    note: 'The label is a real caption: it names the table, and the scroll region too',
    markdown: `:::table[Latency budgets by region]\n${SMALL}\n:::`,
  },
  {
    id: 'caption-bottom',
    label: 'A caption below',
    note: 'caption=bottom: a quieter note under the table',
    markdown: `:::table[Measured at the edge, over the trailing seven days.]{caption=bottom}
${SMALL}
:::`,
  },
  {
    id: 'row-headers',
    label: 'Row headers',
    note: 'headers=both: scroll sideways, and the first column, which heads each row, stays put',
    markdown: `:::table[Commitments by team and quarter]{headers=both width=content}\n${quarters()}\n:::`,
  },
  {
    id: 'row-headers-only',
    label: 'Row headers only',
    note: 'headers=row: a key and value sheet, where GFM’s header row is read as the first row of data',
    markdown: `:::table[Specification]{headers=row}
| Runtime | Node 24 |
| - | - |
| Database | PostgreSQL 17 |
| Region | eu-west-1 |
| Storage | 2 TB |
:::`,
  },
  {
    id: 'footer',
    label: 'A footer with totals',
    note: 'footer=1: sort any column, and the totals stay at the foot',
    markdown: `:::table[Requests by region]{headers=both footer=1}
| Region | Requests | Budget |
| - | - | - |
| eu-west-1 | 12,400 | 200 ms |
| us-east-1 | 9,850 | 200 ms |
| ap-south-1 | 4,120 | 300 ms |
| Total | 26,370 | |
:::`,
  },
  {
    id: 'frozen',
    label: 'Frozen header and footer',
    note: 'Scroll the page through it: the header hangs under the bar, the totals stay at the bottom of the screen, and a pinned scrollbar above them scrolls it sideways from anywhere',
    markdown: `:::table[Every service, every region]{headers=both footer=1 freeze=header,first-column,footer}\n${longTable()}\n| All services | | | | | | | |\n:::`,
  },
  {
    id: 'sorting',
    label: 'Sorting numbers, dates and text',
    note: 'Press a header: numbers by value, dates by date, text in your language; a third press restores the order',
    markdown: `| Release | Shipped | Downloads | Size |
| - | - | - | - |
| Item 10 | 2026-03-02 | 1,204 | 4.2 MB |
| Item 9 | 2025-11-18 | 18,550 | 3.9 MB |
| Item 2 | 2026-07-30 | 310 | 12 MB |
| Éclair | 2024-12-01 | 92,004 | 1.1 MB |`,
  },
  {
    id: 'shadows',
    label: 'Scroll shadows',
    note: 'Scroll sideways: a shadow shows at each side that has more to see',
    markdown: `:::table[Twelve quarters]{width=content}\n${quarters()}\n:::`,
  },
  {
    id: 'stack',
    label: 'Stacked on a phone',
    note: 'responsive=stack: below 36rem each row is a card, its row header the title and its footer a summary',
    markdown: `:::table[On call]{responsive=stack headers=both footer=1}
| Service | Owner | Runbook | Pager |
| - | - | - | - |
| Gateway | Platform | Regional failover | Primary |
| Ledger | Payments | Replay a booking | Secondary |
| Identity | Identity | Rotate signing keys | Primary |
| Three services | Three teams | | Two pagers |
:::`,
  },
  {
    id: 'viewer',
    label: 'Full screen, Fit width and copying',
    note: 'Press the expand button: in the viewer sort it or copy it as CSV or Markdown; Fit width appears only when the table is wider than the screen',
    markdown: `:::table[Open me full screen]{headers=both footer=1}
| Region | Owner | Requests | Budget |
| - | - | - | - |
| eu-west-1 | Platform | 12,400 | 200 ms |
| us-east-1 | Data | 9,850 | 200 ms |
| Total | | 22,250 | |
:::`,
  },
  {
    id: 'numeric',
    label: 'Numeric alignment',
    note: 'Numbers, currencies, percentages and units align right in tabular figures; codes and dates never break',
    markdown: `| Item | Code | Price | Change | Weight |
| - | - | - | - | - |
| Widget | wd-001-a | $1,200.00 | +4.5% | 120 g |
| Gadget | gd-017-b | $89.50 | −3.0% | 2.4 kg |
| Sprocket | sp-220-c | $14.25 | 0.0% | 15 g |`,
  },
]

const rendered = SPECIMENS.map((specimen) => ({
  ...specimen,
  html: renderHtml(parseDocument(`${specimen.markdown}\n`).ast),
}))

const source = `// Generated by \`pnpm --filter @quill/markdown generate:table-specimens\` from
// packages/markdown/scripts/generate-table-specimens.ts. Do not edit.

/** A table specimen: its Markdown, and the HTML \`@quill/markdown\` renders it to (ADR-040). */
export interface TableSpecimen {
  readonly id: string
  readonly label: string
  readonly note: string
  readonly markdown: string
  readonly html: string
}

export const TABLE_SPECIMENS: readonly TableSpecimen[] = ${JSON.stringify(rendered, null, 2)}
`

const target = new URL(
  '../../../apps/web/src/features/design/table-specimens.gen.ts',
  import.meta.url,
)
writeFileSync(fileURLToPath(target), source, 'utf8')
process.stdout.write('wrote apps/web/src/features/design/table-specimens.gen.ts\n')
