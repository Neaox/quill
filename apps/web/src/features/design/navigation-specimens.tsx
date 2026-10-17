import type { ChildPage } from '@quill/markdown'

import type { TableSpecimen } from './table-specimens.gen.ts'
import { TableSpecimenFrame } from './table-specimens.tsx'

/**
 * The navigation blocks (ADR-054), each as Markdown and the HTML the reader
 * is shown, mounted as a reader sees it. A table of contents is part of the
 * body; a child pages list is the slot filled with the pages below, as the
 * page would fill it. `navigation-specimens.test.tsx` renders each Markdown
 * again and fails if the two have drifted.
 */

/** The pages a child pages specimen lists, as a page assembling it would find them. */
export const SPECIMEN_CHILD_PAGES: readonly ChildPage[] = [
  {
    id: 'a',
    title: 'Getting started',
    href: '#getting-started',
    draft: false,
    excerpt: 'Install the command line, sign in, and publish your first page.',
    icon: '🚀',
    children: [
      {
        id: 'b',
        title: 'Install on Linux',
        href: '#install-on-linux',
        draft: false,
        excerpt: 'Packages for Debian, Fedora and Arch.',
        icon: undefined,
        children: [],
      },
    ],
  },
  {
    id: 'c',
    title: 'Writing guide',
    href: '#writing-guide',
    draft: false,
    excerpt: 'House style: plain words, short sentences, headings that say what follows.',
    icon: '✍️',
    children: [],
  },
  {
    id: 'd',
    title: 'Release checklist',
    href: '#release-checklist',
    draft: true,
    excerpt: undefined,
    icon: undefined,
    children: [],
  },
]

export interface NavigationBlockSpecimen extends TableSpecimen {
  /** What fills a child pages slot: these pages, or none at all. */
  readonly pages?: 'sample' | 'none'
}

export const NAVIGATION_BLOCK_SPECIMENS: readonly NavigationBlockSpecimen[] = [
  {
    id: 'toc',
    label: 'Table of contents',
    note: 'titled, levels 2 and 3, bulleted; each entry is the heading’s own permalink',
    markdown:
      '::toc[On this page]\n\n## Before you begin\n\n### What you need\n\n### Who can do this\n\n## Rotate the key\n\n## Tell the team',
    html: '<article><nav class="toc" data-style="bulleted" aria-labelledby="user-content-toc.1"><p class="toc-title" id="user-content-toc.1">On this page</p><ul class="toc-list"><li><a href="#user-content-before-you-begin">Before you begin</a><ul class="toc-list"><li><a href="#user-content-what-you-need">What you need</a></li><li><a href="#user-content-who-can-do-this">Who can do this</a></li></ul></li><li><a href="#user-content-rotate-the-key">Rotate the key</a></li><li><a href="#user-content-tell-the-team">Tell the team</a></li></ul></nav>\n<h2 id="user-content-before-you-begin" aria-labelledby="user-content-title.before-you-begin"><span id="user-content-title.before-you-begin">Before you begin</span><a class="heading-anchor" href="#user-content-before-you-begin" aria-label="Link to this section: Before you begin"><span aria-hidden="true">#</span></a></h2>\n<h3 id="user-content-what-you-need" aria-labelledby="user-content-title.what-you-need"><span id="user-content-title.what-you-need">What you need</span><a class="heading-anchor" href="#user-content-what-you-need" aria-label="Link to this section: What you need"><span aria-hidden="true">#</span></a></h3>\n<h3 id="user-content-who-can-do-this" aria-labelledby="user-content-title.who-can-do-this"><span id="user-content-title.who-can-do-this">Who can do this</span><a class="heading-anchor" href="#user-content-who-can-do-this" aria-label="Link to this section: Who can do this"><span aria-hidden="true">#</span></a></h3>\n<h2 id="user-content-rotate-the-key" aria-labelledby="user-content-title.rotate-the-key"><span id="user-content-title.rotate-the-key">Rotate the key</span><a class="heading-anchor" href="#user-content-rotate-the-key" aria-label="Link to this section: Rotate the key"><span aria-hidden="true">#</span></a></h2>\n<h2 id="user-content-tell-the-team" aria-labelledby="user-content-title.tell-the-team"><span id="user-content-title.tell-the-team">Tell the team</span><a class="heading-anchor" href="#user-content-tell-the-team" aria-label="Link to this section: Tell the team"><span aria-hidden="true">#</span></a></h2></article>',
  },
  {
    id: 'toc-numbered',
    label: 'Numbered and folded',
    note: 'style=numbered collapsed: each section’s subsections fold beside its link',
    markdown:
      '::toc{levels=2-3 style=numbered collapsed}\n\n## Plan the window\n\n### Pick a quiet hour\n\n### Warn the on-call\n\n## Fail over\n\n### Promote the replica',
    html: '<article><nav class="toc" data-style="numbered" data-collapsed="" aria-label="Table of contents"><ol class="toc-list"><li><a href="#user-content-plan-the-window">Plan the window</a><details class="toc-fold"><summary><span class="sr-only">Subsections of Plan the window</span></summary><ol class="toc-list"><li><a href="#user-content-pick-a-quiet-hour">Pick a quiet hour</a></li><li><a href="#user-content-warn-the-on-call">Warn the on-call</a></li></ol></details></li><li><a href="#user-content-fail-over">Fail over</a><details class="toc-fold"><summary><span class="sr-only">Subsections of Fail over</span></summary><ol class="toc-list"><li><a href="#user-content-promote-the-replica">Promote the replica</a></li></ol></details></li></ol></nav>\n<h2 id="user-content-plan-the-window" aria-labelledby="user-content-title.plan-the-window"><span id="user-content-title.plan-the-window">Plan the window</span><a class="heading-anchor" href="#user-content-plan-the-window" aria-label="Link to this section: Plan the window"><span aria-hidden="true">#</span></a></h2>\n<h3 id="user-content-pick-a-quiet-hour" aria-labelledby="user-content-title.pick-a-quiet-hour"><span id="user-content-title.pick-a-quiet-hour">Pick a quiet hour</span><a class="heading-anchor" href="#user-content-pick-a-quiet-hour" aria-label="Link to this section: Pick a quiet hour"><span aria-hidden="true">#</span></a></h3>\n<h3 id="user-content-warn-the-on-call" aria-labelledby="user-content-title.warn-the-on-call"><span id="user-content-title.warn-the-on-call">Warn the on-call</span><a class="heading-anchor" href="#user-content-warn-the-on-call" aria-label="Link to this section: Warn the on-call"><span aria-hidden="true">#</span></a></h3>\n<h2 id="user-content-fail-over" aria-labelledby="user-content-title.fail-over"><span id="user-content-title.fail-over">Fail over</span><a class="heading-anchor" href="#user-content-fail-over" aria-label="Link to this section: Fail over"><span aria-hidden="true">#</span></a></h2>\n<h3 id="user-content-promote-the-replica" aria-labelledby="user-content-title.promote-the-replica"><span id="user-content-title.promote-the-replica">Promote the replica</span><a class="heading-anchor" href="#user-content-promote-the-replica" aria-label="Link to this section: Promote the replica"><span aria-hidden="true">#</span></a></h3></article>',
  },
  {
    id: 'children',
    label: 'Pages under this one',
    note: 'two levels deep, with icons, summaries and a draft; filled for each reader as the page is assembled',
    markdown: '::children[In this section]{depth=2 excerpts icons}',
    html: '<article><section class="live-block child-pages" data-live-block="children" data-live-key="children?depth=2&#x26;sort=manual&#x26;excerpts&#x26;icons" aria-labelledby="user-content-children.1"><p class="child-pages-title" id="user-content-children.1">In this section</p><ul class="child-pages-list"><li class="child-page"><a class="child-page-link" href="#getting-started"><span class="child-page-icon" aria-hidden="true">🚀</span><span class="child-page-title">Getting started</span></a><p class="child-page-excerpt">Install the command line, sign in, and publish your first page.</p><ul class="child-pages-list"><li class="child-page"><a class="child-page-link" href="#install-on-linux"><span class="child-page-icon" data-icon="page" aria-hidden="true"></span><span class="child-page-title">Install on Linux</span></a><p class="child-page-excerpt">Packages for Debian, Fedora and Arch.</p></li></ul></li><li class="child-page"><a class="child-page-link" href="#writing-guide"><span class="child-page-icon" aria-hidden="true">✍️</span><span class="child-page-title">Writing guide</span></a><p class="child-page-excerpt">House style: plain words, short sentences, headings that say what follows.</p></li><li class="child-page"><a class="child-page-link" href="#release-checklist"><span class="child-page-icon" data-icon="page" aria-hidden="true"></span><span class="child-page-title">Release checklist</span></a><span class="badge" data-tone="neutral">Draft</span></li></ul></section></article>',
    pages: 'sample',
  },
  {
    id: 'children-empty',
    label: 'No child pages',
    note: 'the empty state; in the app an editor is also offered “Create a child page”',
    markdown: '::children',
    html: '<article><section class="live-block child-pages" data-live-block="children" data-live-key="children?depth=1&#x26;sort=manual" aria-label="Child pages"><p class="child-pages-empty">No child pages yet</p></section></article>',
    pages: 'none',
  },
]

export function NavigationBlockSpecimens() {
  return (
    <div className="flex flex-col gap-6">
      {NAVIGATION_BLOCK_SPECIMENS.map((specimen) => (
        <TableSpecimenFrame key={specimen.id} specimen={specimen} />
      ))}
    </div>
  )
}
