import type { ClipboardWriter, CopyButton } from './copy.ts'
import { codeSource, createCopyButton } from './copy.ts'
import { watchScrollingCode } from './scrolling-code.ts'

/**
 * Code blocks and code groups, enhanced (ADR-041).
 *
 * The server draws every block in its card (`.code-block`) and every code
 * group as its panels stacked, each captioned with its tab's name, so a
 * reader without script has everything and nothing that does not work. This
 * adds what needs script:
 *
 * - **A copy button on every block**, wherever it sits — in a callout, a
 *   list, a table cell, a card, a diagram slot whose source is showing — and
 *   one per group, which copies the panel on show. A selection made wholly
 *   inside a block turns its button into "Copy selection" (`copy.ts`).
 * - **Tabs for every group**: a WAI-ARIA tablist with arrow keys, Home and
 *   End and a roving tab stop. Choosing "Python" in one group chooses it in
 *   every group on the page that has it — those that share the group's sync
 *   key, or, without one, its default — keeps the group being clicked still
 *   on screen while the page around it changes height, and is remembered for
 *   the reader's next page.
 *
 * Framework-free and dependency-free, like the lightbox: the signed-in
 * application runs it over each document body, the public site bundles it
 * into its reader script.
 */

/** The part of `localStorage` a group's remembered choice needs. */
export interface ChoiceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface CodeBlockOptions {
  /** What a reader calls a block's `data-lang`, for "Copy TypeScript code". */
  readonly languageLabel?: ((language: string) => string | undefined) | undefined
  /** Where each sync key's last choice is kept; defaults to the page's `localStorage`. */
  readonly storage?: ChoiceStorage | null | undefined
  readonly clipboard?: ClipboardWriter | undefined
}

/** Where every sync key's choice is remembered, as one JSON object. */
export const CHOICES_KEY = 'code-group-choices'

/** The sync key of groups that name none: they share choices by tab name across the page. */
const DEFAULT_SYNC = ''

let groupsMade = 0

interface Enhanced {
  readonly card: Element
  readonly button: CopyButton
}

/** A group's sync key, from `data-sync`, or the page's default. */
function syncOf(element: Element): string {
  return element.getAttribute('data-sync') ?? DEFAULT_SYNC
}

function readChoices(storage: ChoiceStorage | null): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(CHOICES_KEY) ?? '{}')
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? Object.fromEntries(
          Object.entries(parsed).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : {}
  } catch {
    return {}
  }
}

function writeChoice(storage: ChoiceStorage | null, key: string, label: string): void {
  try {
    storage?.setItem(CHOICES_KEY, JSON.stringify({ ...readChoices(storage), [key]: label }))
  } catch {
    // A full or forbidden store costs the reader the memory of a choice, nothing else.
  }
}

/** The page's `localStorage`, or null where reading it is refused. */
function pageStorage(doc: Document): ChoiceStorage | null {
  try {
    return doc.defaultView?.localStorage ?? null
  } catch {
    return null
  }
}

function labelOf(panel: Element): string {
  return panel.querySelector(':scope > .code-caption > .code-label')?.textContent.trim() ?? ''
}

/** A panel's code element, or its `pre` where the code is not wrapped; null with neither. */
function codeOf(panel: Element): Element | null {
  const pre = panel.querySelector(':scope > pre')
  return pre?.querySelector(':scope > code') ?? pre
}

/** Moves a strip of tabs sideways just enough to show one, without scrolling the page. */
export function revealTab(strip: HTMLElement, tab: HTMLElement): void {
  const start = tab.offsetLeft - strip.offsetLeft - FADE
  const end = tab.offsetLeft - strip.offsetLeft + tab.offsetWidth + FADE
  if (start < strip.scrollLeft) strip.scrollLeft = Math.max(start, 0)
  else if (end > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = end - strip.clientWidth
}

/** How far the strip's ends fade (`.code-tabs[data-overflow]`), kept clear around the chosen tab. */
const FADE = 40

/**
 * Says which ends of a strip have tabs scrolled out of sight
 * (`data-overflow="start end"`), which the stylesheet fades so the reader
 * can see there is more.
 */
function markOverflow(strip: HTMLElement): void {
  const hidden = strip.scrollWidth - strip.clientWidth
  const ends = [
    ...(strip.scrollLeft > 1 ? ['start'] : []),
    ...(strip.scrollLeft < hidden - 1 ? ['end'] : []),
  ]
  if (ends.length === 0) delete strip.dataset['overflow']
  else strip.dataset['overflow'] = ends.join(' ')
}

/** Where each key moves the selected tab, as a position among `count` tabs. */
const NEXT: Readonly<Record<string, (index: number, count: number) => number>> = {
  ArrowRight: (index, count) => (index + 1) % count,
  ArrowLeft: (index, count) => (index - 1 + count) % count,
  Home: () => 0,
  End: (_index, count) => count - 1,
}

/** Asks the group holding `tab` to show it, as part of a choice made in another group. */
const SYNC_EVENT = 'code-group:sync'

interface Tab {
  readonly button: HTMLButtonElement
  /** The tab panel: a wrapper, because a captioned figure may not take the role itself. */
  readonly panel: HTMLElement
  /** The server's card, captioned for readers without script. */
  readonly card: HTMLElement
  readonly label: string
}

interface Context {
  readonly doc: Document
  readonly storage: ChoiceStorage | null
  readonly copyButton: (card: Element, code: () => Element) => CopyButton
  readonly name: (code: Element | null) => string | undefined
}

/** Turns one server-drawn group into tabs. Returns what turns it back. */
function enhanceGroup(
  element: HTMLElement,
  [firstPanel, ...otherPanels]: readonly [HTMLElement, ...HTMLElement[]],
  context: Context,
): () => void {
  const { doc, storage } = context
  groupsMade += 1
  const id = `code-group-${groupsMade}`
  const key = syncOf(element)
  const header = doc.createElement('div')
  header.className = 'code-group-header'
  const strip = doc.createElement('div')
  strip.className = 'code-tabs'
  strip.setAttribute('role', 'tablist')
  strip.setAttribute('aria-label', 'Code examples')

  const tabOf = (card: HTMLElement, index: number): Tab => {
    const label = labelOf(card) || `Code ${index + 1}`
    const button = doc.createElement('button')
    button.type = 'button'
    button.className = 'code-tab'
    button.id = `${id}-tab-${index}`
    button.setAttribute('role', 'tab')
    button.setAttribute('aria-controls', `${id}-panel-${index}`)
    button.dataset['label'] = label
    button.textContent = label
    const panel = doc.createElement('div')
    panel.className = 'code-panel'
    panel.id = `${id}-panel-${index}`
    panel.setAttribute('role', 'tabpanel')
    panel.setAttribute('aria-labelledby', button.id)
    panel.tabIndex = 0
    card.before(panel)
    panel.append(card)
    // The caption's name is the tab's now; a caption that only named it goes.
    const caption = card.querySelector<HTMLElement>(':scope > .code-caption')
    if (caption !== null && caption.querySelector('.code-title') === null) caption.hidden = true
    return { button, panel, card, label }
  }
  const first = tabOf(firstPanel, 0)
  const tabs: readonly Tab[] = [
    first,
    ...otherPanels.map((panel, index) => tabOf(panel, index + 1)),
  ]

  const remembered = readChoices(storage)[key]
  let active = tabs.find((tab) => tab.label === remembered) ?? first
  const copy = context.copyButton(element, () => codeOf(active.card) ?? active.card)
  strip.append(...tabs.map((tab) => tab.button))
  header.append(strip, copy.element)
  element.prepend(header)
  element.dataset['enhanced'] = 'true'

  const show = (chosen: Tab): void => {
    active = chosen
    for (const tab of tabs) {
      const selected = tab === chosen
      tab.button.setAttribute('aria-selected', String(selected))
      tab.button.tabIndex = selected ? 0 : -1
      tab.panel.hidden = !selected
    }
    copy.setLanguage(context.name(codeOf(chosen.card)))
    revealTab(strip, chosen.button)
    markOverflow(strip)
  }

  const choose = (chosen: Tab): void => {
    // The group being used stays where it is on screen while every other
    // group on the page changes panel, and with it, perhaps, its height.
    const before = strip.getBoundingClientRect().top
    for (const other of doc.querySelectorAll('.code-group[data-enhanced="true"]')) {
      if (other === element || syncOf(other) !== key) continue
      for (const tab of other.querySelectorAll('[role="tab"]')) {
        if (tab.getAttribute('data-label') === chosen.label) {
          tab.dispatchEvent(new CustomEvent(SYNC_EVENT))
        }
      }
    }
    show(chosen)
    const drift = strip.getBoundingClientRect().top - before
    if (drift !== 0) doc.defaultView?.scrollBy(0, drift)
    writeChoice(storage, key, chosen.label)
  }

  const tabFor = (target: EventTarget | null): readonly Tab[] =>
    tabs.filter((tab) => tab.button === target)
  const onClick = (event: Event): void => {
    tabFor(event.target).forEach(choose)
  }
  const onSync = (event: Event): void => {
    tabFor(event.target).forEach(show)
  }
  const onKey = (event: KeyboardEvent): void => {
    const move = NEXT[event.key]
    if (move === undefined) return
    event.preventDefault()
    const next = move(
      tabs.findIndex((tab) => tab === active),
      tabs.length,
    )
    for (const tab of tabs.slice(next, next + 1)) {
      choose(tab)
      tab.button.focus()
    }
  }
  const onScroll = (): void => {
    markOverflow(strip)
  }
  strip.addEventListener('click', onClick)
  strip.addEventListener('keydown', onKey)
  strip.addEventListener(SYNC_EVENT, onSync, true)
  strip.addEventListener('scroll', onScroll, { passive: true })
  // A strip that fits on a wide screen may not on a turned phone.
  const Observer = doc.defaultView?.ResizeObserver
  const resized = Observer === undefined ? undefined : new Observer(onScroll)
  resized?.observe(strip)
  show(active)

  return () => {
    resized?.disconnect()
    header.remove()
    delete element.dataset['enhanced']
    for (const { panel, card } of tabs) {
      panel.replaceWith(card)
      const caption = card.querySelector<HTMLElement>(':scope > .code-caption')
      if (caption !== null) caption.hidden = false
    }
  }
}

/**
 * Gives every code block under `root` its copy button and every code group
 * its tabs. Returns what takes it all away again, leaving the server's markup
 * as it was.
 */
export function enhanceCodeBlocks(
  root: Element | Document,
  options: CodeBlockOptions = {},
): () => void {
  const doc = 'body' in root ? root : root.ownerDocument
  const storage = options.storage === undefined ? pageStorage(doc) : options.storage
  const enhanced: Enhanced[] = []
  const undo: (() => void)[] = []
  const context: Context = {
    doc,
    storage,
    name: (code) => {
      const language = code?.getAttribute('data-lang')
      return language === null || language === undefined
        ? undefined
        : (options.languageLabel?.(language) ?? language)
    },
    copyButton: (card, code) => {
      const made = createCopyButton(doc, {
        source: codeSource(code),
        language: context.name(code()),
        clipboard: options.clipboard,
      })
      enhanced.push({ card, button: made })
      return made
    },
  }

  /* Groups first: their panels' blocks are copied from the group's header. */
  for (const element of root.querySelectorAll<HTMLElement>('.code-group:not([data-enhanced])')) {
    const [first, ...rest] = element.querySelectorAll<HTMLElement>(':scope > .code-block')
    if (first !== undefined) undo.push(enhanceGroup(element, [first, ...rest], context))
  }

  /* A block from before cards, or from anywhere else, is given one, so its button has a corner. */
  for (const pre of root.querySelectorAll<HTMLElement>('pre')) {
    if (pre.matches(':is(.code-block, .diagram) > pre')) continue
    const card = doc.createElement('div')
    card.className = 'code-block'
    pre.before(card)
    card.append(pre)
    undo.push(() => {
      card.replaceWith(pre)
    })
  }

  /* Every other block: its own button, in its own card. */
  for (const card of root.querySelectorAll<HTMLElement>('.code-block, .diagram')) {
    if (card.closest('.code-group[data-enhanced="true"]') !== null) continue
    if (card.querySelector(':scope > .code-copy') !== null) continue
    const pre = card.querySelector<HTMLElement>(':scope > pre')
    if (pre === null) continue
    const copy = context.copyButton(card, () => pre.querySelector(':scope > code') ?? pre)
    card.append(copy.element)
  }

  /*
   * One cheap watch on the selection, debounced to the frame: where its
   * common ancestor is, and nothing more. A selection wholly inside a block
   * turns that block's button to "Copy selection"; the block's own button
   * still checks the selection again when it is pressed (`copy.ts`).
   */
  const buttons = new Map<Node, CopyButton>(enhanced.map(({ card, button: made }) => [card, made]))
  let frame = 0
  let offering: CopyButton | undefined
  const view = doc.defaultView
  const watch = (): void => {
    const selection = doc.getSelection()
    const node =
      selection === null || selection.isCollapsed || selection.rangeCount === 0
        ? null
        : selection.getRangeAt(0).commonAncestorContainer
    const parent = node?.parentElement
    const card =
      parent?.closest('.code-group[data-enhanced="true"]') ??
      parent?.closest('.code-block, .diagram') ??
      undefined
    const found =
      (node === null ? undefined : buttons.get(node)) ??
      (card === undefined ? undefined : buttons.get(card))
    if (found === offering) return
    offering?.setMode('code')
    found?.setMode('selection')
    offering = found
  }
  const onSelection = (): void => {
    if (view === null) return
    view.cancelAnimationFrame(frame)
    frame = view.requestAnimationFrame(watch)
  }
  doc.addEventListener('selectionchange', onSelection)

  /* Last, once every block is in its card and panel: what overflows is a tab stop. */
  undo.push(watchScrollingCode(root, context.name))

  return () => {
    doc.removeEventListener('selectionchange', onSelection)
    view?.cancelAnimationFrame(frame)
    for (const { button: made } of enhanced) made.dispose()
    for (const step of undo.toReversed()) step()
  }
}
