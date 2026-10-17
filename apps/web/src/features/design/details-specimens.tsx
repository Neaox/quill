import type { TableSpecimen } from './table-specimens.gen.ts'
import { TableSpecimenFrame } from './table-specimens.tsx'

/**
 * Details and accordions (ADR-048), each as Markdown and the HTML the
 * renderer makes of it, mounted as a reader sees it. The HTML is the
 * renderer's own: `details-specimens.test.tsx` renders each Markdown again
 * and fails if the two have drifted.
 */
export const DETAILS_SPECIMENS: readonly TableSpecimen[] = [
  {
    id: 'details',
    label: 'Details',
    note: 'closed, open by default, and nested; the summary is inline Markdown',
    markdown:
      ":::details[Why is `pnpm check` slow the first time?]\nIt builds every package's type declarations once, then reuses them.\n\n```sh\npnpm check\n```\n:::\n\n::::details[Before you upgrade]{open}\nBack up the database first.\n\n:::details[How do I back it up?]\nRun `pnpm db:backup` and keep the file somewhere safe.\n:::\n::::",
    html: '<article><details class="details">\n<summary>Why is <code>pnpm check</code> slow the first time?</summary>\n<div class="details-body">\n<p>It builds every package\'s type declarations once, then reuses them.</p>\n<div class="code-block"><pre><code data-lang="sh">pnpm check</code></pre></div>\n</div>\n</details>\n<details class="details" open>\n<summary>Before you upgrade</summary>\n<div class="details-body">\n<p>Back up the database first.</p>\n<details class="details">\n<summary>How do I back it up?</summary>\n<div class="details-body">\n<p>Run <code>pnpm db:backup</code> and keep the file somewhere safe.</p>\n</div>\n</details>\n</div>\n</details></article>',
  },
  {
    id: 'accordion',
    label: 'Accordion',
    note: 'opening one closes the others',
    markdown:
      "::::accordion{name=faq}\n:::details[How do I invite someone?]\nFrom the workspace's settings, under **People**.\n:::\n\n:::details[How do I leave a workspace?]\nFrom your profile menu.\n:::\n\n:::details[Can a document live in two workspaces?]\nNo: link to it instead.\n:::\n::::",
    html: '<article><div class="accordion">\n<details class="details" name="user-content-faq">\n<summary>How do I invite someone?</summary>\n<div class="details-body">\n<p>From the workspace\'s settings, under <strong>People</strong>.</p>\n</div>\n</details>\n<details class="details" name="user-content-faq">\n<summary>How do I leave a workspace?</summary>\n<div class="details-body">\n<p>From your profile menu.</p>\n</div>\n</details>\n<details class="details" name="user-content-faq">\n<summary>Can a document live in two workspaces?</summary>\n<div class="details-body">\n<p>No: link to it instead.</p>\n</div>\n</details>\n</div></article>',
  },
  {
    id: 'callouts',
    label: 'Folded callouts',
    note: 'a callout drawn as a details, as Obsidian writes it or with type=',
    markdown:
      '> [!tip]- Keyboard shortcuts\n> Press :kbd[?] anywhere to see them.\n\n:::details[This deletes the workspace]{type=caution}\nEvery document, revision and attachment in it goes, and cannot be restored.\n:::',
    html: '<article><details class="details callout callout-tip">\n<summary>Keyboard shortcuts</summary>\n<div class="details-body">\n<p>Press <kbd>?</kbd> anywhere to see them.</p>\n</div>\n</details>\n<details class="details callout callout-caution">\n<summary>This deletes the workspace</summary>\n<div class="details-body">\n<p>Every document, revision and attachment in it goes, and cannot be restored.</p>\n</div>\n</details></article>',
  },
  {
    id: 'github',
    label: 'GitHub’s HTML',
    note: 'read live and written back as written',
    markdown:
      '<details>\n<summary>Supported browsers</summary>\n\n| Browser | Since |\n| ------- | ----- |\n| Chrome  | 120   |\n| Firefox | 121   |\n\n</details>',
    html: '<article><details class="details">\n<summary>Supported browsers</summary>\n<div class="details-body">\n<div class="table-block"><div class="table-scroll" tabindex="0" role="group" aria-label="Table"><table>\n<thead>\n<tr>\n<th scope="col">Browser</th>\n<th scope="col" class="align-numeric">Since</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>Chrome</td>\n<td class="align-numeric">120</td>\n</tr>\n<tr>\n<td>Firefox</td>\n<td class="align-numeric">121</td>\n</tr>\n</tbody>\n</table></div></div>\n</div>\n</details></article>',
  },
]

export function DetailsSpecimens() {
  return (
    <div className="flex flex-col gap-6">
      {DETAILS_SPECIMENS.map((specimen) => (
        <TableSpecimenFrame key={specimen.id} specimen={specimen} />
      ))}
    </div>
  )
}
