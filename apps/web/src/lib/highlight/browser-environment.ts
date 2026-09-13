import type {
  CodeBlockElement,
  HighlightClientEnvironment,
  HighlightRoot,
  TextNodeLike,
} from '@quill/highlight/client'

/**
 * The browser half of ADR-030's client pass.
 *
 * `@quill/highlight/client` deliberately touches no DOM: `applyHighlighting`
 * takes every capability it needs — the `CSS.highlights` registry, the
 * `Highlight` constructor, a range factory, a markup parser, and the root to
 * walk — as injected, structurally typed values, so the package stays
 * testable without a browser and so the application decides once how those
 * map onto the real platform. This is that decision, and it is the only file
 * in the web app that names them.
 *
 * A factory (`docs/architecture/patterns.md`: factory plus strategy) rather
 * than a module-level constant, because the window is an argument: the app
 * passes the real one, a test passes jsdom's, and neither has to reach for a
 * global.
 */

/** The slice of a `Window` this adapter reads. Anything wider would be untestable. */
export interface HighlightWindow {
  readonly document: Pick<Document, 'createElement' | 'createRange'>
  readonly Node: typeof Node
  readonly Text: typeof Text
  readonly StaticRange?: typeof StaticRange | undefined
  readonly CSS?: HighlightClientEnvironment['CSS']
  readonly Highlight?: HighlightClientEnvironment['Highlight']
}

export interface BrowserHighlighting {
  readonly environment: HighlightClientEnvironment
  /** Presents a rendered document as the root `applyHighlighting` walks. */
  rootOf(element: ParentNode): HighlightRoot
}

export function createBrowserHighlighting(view: HighlightWindow): BrowserHighlighting {
  /**
   * Builds the range object a `Highlight` holds.
   *
   * `StaticRange` is preferred: it is a plain value, so a page with thousands
   * of token ranges pays nothing for the bookkeeping a live `Range` keeps
   * against every DOM mutation. Where it is missing — it landed later than
   * `CSS.highlights` in one or two browsers — a `Range` does the same job.
   *
   * The node arrives typed structurally (`{ data: string }`), which is all
   * the highlight package needs of it; `instanceof` is what turns it back
   * into the real `Text` the platform API requires, and it is a genuine
   * check rather than an assertion.
   */
  function createRange(node: TextNodeLike, start: number, end: number): unknown {
    if (!(node instanceof view.Text)) {
      throw new TypeError('applyHighlighting was given a text node that is not a DOM text node')
    }
    if (view.StaticRange !== undefined) {
      return new view.StaticRange({
        startContainer: node,
        startOffset: start,
        endContainer: node,
        endOffset: end,
      })
    }
    const range = view.document.createRange()
    range.setStart(node, start)
    range.setEnd(node, end)
    return range
  }

  /**
   * Parses the fallback markup into nodes.
   *
   * A `<template>` is the one element whose content is parsed but never run:
   * scripts inside it do not execute and its subresources are not fetched.
   * The markup itself comes from `toMarkup`, which escapes every character of
   * the code it wraps, so this is a second line rather than the only one.
   */
  function parseMarkup(html: string): unknown[] {
    const template = view.document.createElement('template')
    template.innerHTML = html
    return [...template.content.childNodes]
  }

  /**
   * A code block, as the package reads it: its attributes, its text nodes,
   * and a way to replace its children.
   *
   * Only text nodes are offered, because that is the only child a rendered
   * code block has (ADR-030: "one text node with `data-lang` and
   * `data-tokens`") and the only child either presentation can use.
   */
  function toCodeBlock(element: Element): CodeBlockElement {
    return {
      getAttribute: (name) => element.getAttribute(name),
      childNodes: [...element.childNodes].filter((node) => node instanceof view.Text),
      replaceChildren: (...nodes) => {
        element.replaceChildren(...nodes.filter((node) => node instanceof view.Node))
      },
    }
  }

  return {
    environment: {
      ...(view.CSS === undefined ? {} : { CSS: view.CSS }),
      ...(view.Highlight === undefined ? {} : { Highlight: view.Highlight }),
      createRange,
      parseMarkup,
    },
    rootOf: (element) => ({
      querySelectorAll: (selector) => [...element.querySelectorAll(selector)].map(toCodeBlock),
    }),
  }
}
