import { Fragment } from '@tiptap/pm/model'
import type { Node as PMNode } from '@tiptap/pm/model'
import { closeHistory, isHistoryTransaction, undo } from '@tiptap/pm/history'
import { PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorState, SelectionBookmark, Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'

import type { ParseMarkdown, PasteBatch } from './markdown-parser.ts'
import { cancelLanding, insertBatch, mapLanding, prepareLanding } from './paste-landing.ts'
import type { Landing } from './paste-landing.ts'
import { createPasteStatus, pasteMessages } from './paste-status.ts'
import type { PasteAnnouncer, PasteStatus, PasteStatusState } from './paste-status.ts'
import { blockWeight } from './time-slice.ts'
import type { SliceHost, Slicer } from './time-slice.ts'

/**
 * A large paste, landing a batch at a time (quill-plan.md section 31).
 *
 * The paste's own task makes the gap the blocks will land in and puts a
 * "Pasting…" card there, so the paste is acknowledged in the same frame
 * (`paste-landing.ts`, `paste-status.ts`). The Markdown is parsed and
 * converted in pieces off the main thread (`markdown-parser.ts`); each
 * piece's blocks are queued, and the page lands them in slices that each fit
 * in half a frame (`time-slice.ts`), giving the page its turn between them, so
 * typing, scrolling and selecting never wait, and letting the browser draw
 * what has landed as often as drawing is cheap enough to afford. The first
 * piece is small and is where the paste lands, so the first screenful is on
 * screen almost at once; after that, document order is the natural order. The
 * caret stays where the writer pasted, before the blocks, so they land after
 * it without the browser placing it again in every slice.
 *
 * **One change, however many batches.** The first transaction that changes the
 * document closes the history group before it, and every later one joins it,
 * as an appended transaction does — so do the writer's own edits while the
 * paste lands — and one undo takes the whole paste away. Every batch but the
 * last is marked `preventUpdate`, and the editor's change handler waits while
 * a paste is landing (`isPasteLanding`), so autosave, the recovery store and
 * the offline merge see one change: the document with the whole paste in it.
 * The document is never saved half pasted as if that were the writer's.
 *
 * **Never lost, never stuck.** Escape or Cancel takes back what has landed —
 * by undoing the paste's own history group, which restores even a selection it
 * replaced, unless the writer's edits have joined it, in which case the landed
 * blocks are taken out — and a paste that cannot be read is taken back the
 * same way and says so, with Try again. Undo while a paste lands ends it too.
 */

/** How long "Pasted 1,200 blocks" stays before the card goes. */
export const PASTE_SETTLED_MS = 2_400

/** A paste that lands within this, start to end, behaves as one made at once and scrolls to its end. */
const FELT_INSTANT_MS = 300

/** A large paste on its way: where it lands, and what its card says. */
export interface PendingPaste {
  readonly id: number
  readonly landing: Landing
  readonly state: PasteStatusState
  readonly status: PasteStatus
  /** Where a failed paste is tried again: the selection it was pasted over, put back. */
  readonly retryAt?: SelectionBookmark | undefined
}

type PasteMeta =
  | { readonly kind: 'start'; readonly pending: PendingPaste }
  | {
      readonly kind: 'landed'
      readonly id: number
      readonly landing: Landing
      readonly state?: PasteStatusState
    }
  | { readonly kind: 'end'; readonly id: number }

export const pasteKey = new PluginKey<PendingPaste | null>('editorPaste')

function isPasteMeta(value: unknown): value is PasteMeta {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value.kind === 'start' || value.kind === 'landed' || value.kind === 'end')
  )
}

function metaOf(transaction: Transaction): PasteMeta | undefined {
  const value: unknown = transaction.getMeta(pasteKey)
  return isPasteMeta(value) ? value : undefined
}

/** The pending paste after a transaction: begun, moved by an edit, landed further, or over. */
export function nextPending(
  pending: PendingPaste | null,
  transaction: Transaction,
): PendingPaste | null {
  const meta = metaOf(transaction)
  if (meta?.kind === 'start') return meta.pending
  if (pending === null) return null
  if (meta?.kind === 'end' && meta.id === pending.id) return null
  // Undo or redo while it lands has taken the paste, or some of it, away.
  if (pending.state === 'landing' && isHistoryTransaction(transaction)) return null
  if (meta?.kind === 'landed' && meta.id === pending.id) {
    return { ...pending, landing: meta.landing, state: meta.state ?? pending.state }
  }
  if (!transaction.docChanged) return pending
  return {
    ...pending,
    landing: mapLanding(pending.landing, transaction.mapping),
    retryAt: pending.retryAt?.map(transaction.mapping),
  }
}

/** Whether a paste is still arriving, during which the document is not the writer's to save. */
export function isPasteLanding(state: EditorState): boolean {
  return pasteKey.getState(state)?.state === 'landing'
}

/** The card, where the next blocks will land. */
export function pasteDecorations(state: EditorState): DecorationSet | null {
  const pending = pasteKey.getState(state)
  if (pending == null) return null
  return DecorationSet.create(state.doc, [
    Decoration.widget(pending.landing.at, () => pending.status.element, {
      side: -1,
      key: `paste-${String(pending.id)}`,
      ignoreSelection: true,
      stopEvent: () => true,
    }),
  ])
}

interface Queued {
  readonly json: PasteBatch['blocks'][number]
  /** What there is to draw of it (`blockWeight`). */
  readonly weight: number
  /** How far through the paste the block reaches, from 0 to 1. */
  readonly progress: number
}

/** A large paste's work outside the editor state: its parse, its queue, its history group. */
interface Arrival {
  readonly id: number
  readonly markdown: string
  readonly parse: ParseMarkdown
  readonly startedAt: number
  abort: AbortController
  readonly queue: Queued[]
  /** Every piece has been handed over. */
  parsed: boolean
  landing: boolean
  /** The first transaction of the paste that changed the document, which the rest join. */
  root: Transaction | undefined
  /** The writer's own edits joined the paste's history group while it landed. */
  joined: boolean
  settle: ReturnType<typeof setTimeout> | undefined
}

export interface LargePasteContext {
  readonly host: SliceHost
  readonly announcer: PasteAnnouncer
  /** What landing blocks costs in this editor, learned across its pastes. */
  readonly slicer: Slicer
}

const arrivals = new WeakMap<EditorView, Arrival>()
let pastes = 0

function pendingOf(view: EditorView, arrival: Arrival): PendingPaste | undefined {
  if (view.isDestroyed) return undefined
  const pending = pasteKey.getState(view.state)
  return pending?.id === arrival.id ? pending : undefined
}

/** Marks a transaction of the paste's as part of its one history group. */
function intoGroup(arrival: Arrival, tr: Transaction): void {
  if (!tr.docChanged) return
  if (arrival.root === undefined) {
    closeHistory(tr)
    arrival.root = tr
  } else {
    tr.setMeta('appendedTransaction', arrival.root)
  }
}

/** Ends whatever paste is under way in `view`, taking back what had landed. */
function abandon(view: EditorView, context: LargePasteContext, announce: boolean): void {
  const arrival = arrivals.get(view)
  if (arrival === undefined) return
  arrival.abort.abort()
  clearTimeout(arrival.settle)
  arrivals.delete(view)
  const pending = pendingOf(view, arrival)
  if (pending === undefined) return
  if (pending.state === 'landing') {
    takeBack(view, arrival, pending)
    if (announce) context.announcer.announce(pasteMessages.cancelled)
  }
  if (pasteKey.getState(view.state) !== null) {
    view.dispatch(view.state.tr.setMeta(pasteKey, { kind: 'end', id: arrival.id }))
  }
}

/**
 * Puts the document back as it was before the paste: by undoing the paste's
 * own history group where nothing else joined it, otherwise by taking out
 * what landed.
 */
function takeBack(view: EditorView, arrival: Arrival, pending: PendingPaste): void {
  if (arrival.root !== undefined && !arrival.joined && undo(view.state, view.dispatch)) return
  const tr = view.state.tr
  cancelLanding(tr, pending.landing)
  if (arrival.root !== undefined) tr.setMeta('appendedTransaction', arrival.root)
  view.dispatch(tr.setMeta(pasteKey, { kind: 'end', id: arrival.id }))
}

/**
 * Begins a large paste of `markdown` at the selection: the gap and the card
 * now, in this task; the blocks as they arrive.
 */
export function startLargePaste(
  view: EditorView,
  markdown: string,
  parse: ParseMarkdown,
  context: LargePasteContext,
): void {
  // A newer paste takes the place of one still landing.
  abandon(view, context, false)
  pastes += 1
  const id = pastes
  const arrival: Arrival = {
    id,
    markdown,
    parse,
    startedAt: context.host.now(),
    abort: new AbortController(),
    queue: [],
    parsed: false,
    landing: false,
    root: undefined,
    joined: false,
    settle: undefined,
  }
  arrivals.set(view, arrival)
  const status = createPasteStatus(view.dom.ownerDocument, {
    cancel: () => {
      abandon(view, context, true)
    },
    retry: () => {
      retry(view, arrival, context)
    },
    dismiss: () => {
      abandon(view, context, false)
    },
  })
  const tr = view.state.tr
  const landing = prepareLanding(tr)
  intoGroup(arrival, tr)
  view.dispatch(
    tr
      .setMeta(pasteKey, { kind: 'start', pending: { id, landing, state: 'landing', status } })
      .setMeta('preventUpdate', true),
  )
  context.announcer.announce(pasteMessages.landing)
  receive(view, arrival, context)
}

/** Parses the paste, queueing each piece's blocks as it is handed over. */
function receive(view: EditorView, arrival: Arrival, context: LargePasteContext): void {
  const { signal } = arrival.abort
  let reached = 0
  const onBatch = ({ blocks, progress }: PasteBatch): void => {
    // An undo while it landed took the paste away: it stops arriving.
    if (pendingOf(view, arrival) === undefined) {
      stop(view, arrival)
      return
    }
    const step = blocks.length === 0 ? 0 : (progress - reached) / blocks.length
    blocks.forEach((json, index) => {
      arrival.queue.push({
        json,
        weight: blockWeight(json),
        progress: reached + step * (index + 1),
      })
    })
    reached = progress
    void land(view, arrival, context)
  }
  arrival.parse(arrival.markdown, onBatch, signal).then(
    () => {
      arrival.parsed = true
      void land(view, arrival, context)
    },
    () => {
      if (!signal.aborted) fail(view, arrival, context)
    },
  )
}

/** Converts the next queued blocks that fit in the slicer's allowance. */
function nextSlice(
  arrival: Arrival,
  view: EditorView,
  slicer: Slicer,
): { nodes: PMNode[]; weight: number; progress: number } {
  const { schema } = view.state
  const nodes: PMNode[] = []
  const rate = slicer.rate()
  const { budget } = slicer
  let planned = slicer.overhead()
  let weight = 0
  let progress = 0
  // Until every piece is in, the last block waits: the transaction that lands
  // it is the one that ends the paste, and the one autosave hears about.
  const keep = arrival.parsed ? 0 : 1
  while (arrival.queue.length > keep) {
    const entry = arrival.queue[0]
    /* v8 ignore next -- the loop runs only while the queue holds more than it keeps. */
    if (entry === undefined) break
    const cost = rate * entry.weight
    if (nodes.length > 0 && planned + cost > budget) break
    arrival.queue.shift()
    nodes.push(schema.nodeFromJSON(entry.json))
    planned += cost
    weight += entry.weight
    progress = entry.progress
  }
  return { nodes, weight, progress }
}

/** Lands queued blocks a slice at a time until the queue is empty or the paste is over. */
async function land(view: EditorView, arrival: Arrival, context: LargePasteContext): Promise<void> {
  if (arrival.landing) return
  arrival.landing = true
  const { slicer } = context
  try {
    for (;;) {
      const pending = pendingOf(view, arrival)
      if (pending === undefined) {
        stop(view, arrival)
        return
      }
      if (pending.state !== 'landing' || arrival.abort.signal.aborted) return
      const started = context.host.now()
      const { nodes, weight, progress } = nextSlice(arrival, view, slicer)
      const last = arrival.parsed && arrival.queue.length === 0
      if (nodes.length === 0 && !last) return
      const tr = view.state.tr
      const landing = insertBatch(tr, pending.landing, Fragment.from(nodes))
      if (last) {
        finish(view, arrival, context, { tr, landing, pending })
        return
      }
      intoGroup(arrival, tr)
      view.dispatch(
        tr
          .setMeta(pasteKey, { kind: 'landed', id: arrival.id, landing })
          .setMeta('preventUpdate', true),
      )
      pending.status.progress(progress)
      slicer.record(weight, context.host.now() - started)
      // oxlint-disable-next-line no-await-in-loop -- each slice waits for the page's turn
      await context.host.yield()
    }
  } finally {
    arrival.landing = false
  }
}

/** Lands the last blocks, which is the change autosave hears about, and settles the card. */
function finish(
  view: EditorView,
  arrival: Arrival,
  context: LargePasteContext,
  { tr, landing, pending }: { tr: Transaction; landing: Landing; pending: PendingPaste },
): void {
  if (landing.blocks === 0) {
    // Nothing in it to paste: put back what was made ready for it.
    cancelLanding(tr, landing)
    intoGroup(arrival, tr)
    arrivals.delete(view)
    view.dispatch(tr.setMeta(pasteKey, { kind: 'end', id: arrival.id }))
    return
  }
  intoGroup(arrival, tr)
  tr.setMeta(pasteKey, { kind: 'landed', id: arrival.id, landing, state: 'landed' })
  // A paste that landed as if at once ends as any paste does, the caret
  // after it and in view. One the writer watched arrive leaves the caret and
  // the view where they were: what they are reading is the start of it, and
  // a caret sent to the end of a thousand new blocks would have the browser
  // draw every one of them in a single task to put it there.
  if (context.host.now() - arrival.startedAt < FELT_INSTANT_MS) {
    tr.setSelection(TextSelection.near(tr.doc.resolve(landing.at), -1)).scrollIntoView()
  }
  view.dispatch(tr.setMeta('uiEvent', 'paste'))
  pending.status.landed(landing.blocks)
  context.announcer.announce(pasteMessages.landed(landing.blocks))
  // Whatever ends the paste sooner — a newer one, the editor going — clears this.
  arrival.settle = setTimeout(() => {
    arrivals.delete(view)
    view.dispatch(view.state.tr.setMeta(pasteKey, { kind: 'end', id: arrival.id }))
  }, PASTE_SETTLED_MS)
}

/** A paste that could not be read: what landed is taken back, and the card says so. */
function fail(view: EditorView, arrival: Arrival, context: LargePasteContext): void {
  const pending = pendingOf(view, arrival)
  if (pending === undefined) return
  arrival.abort.abort()
  takeBack(view, arrival, pending)
  // The card stays where the paste would have landed, between blocks, to
  // offer it again; taking the paste back put the selection it replaced back.
  const { doc, selection } = view.state
  const $at = doc.resolve(Math.min(pending.landing.from, doc.content.size))
  const at = $at.parent.isTextblock ? $at.after() : $at.pos
  const gap: Landing = {
    from: at,
    at,
    empty: undefined,
    replaced: undefined,
    split: false,
    blocks: 0,
  }
  view.dispatch(
    view.state.tr.setMeta(pasteKey, {
      kind: 'start',
      pending: { ...pending, landing: gap, state: 'failed', retryAt: selection.getBookmark() },
    }),
  )
  pending.status.failed()
  context.announcer.announce(pasteMessages.failed, 'assertive')
}

/** Tries a failed paste again, where its card is. */
function retry(view: EditorView, arrival: Arrival, context: LargePasteContext): void {
  const pending = pendingOf(view, arrival)
  if (pending === undefined) return
  const { doc } = view.state
  /* v8 ignore next 2 -- a failed paste always knows where it was pasted. */
  const selection =
    pending.retryAt?.resolve(doc) ?? TextSelection.near(doc.resolve(pending.landing.at))
  const tr = view.state.tr.setSelection(selection)
  view.dispatch(tr.setMeta(pasteKey, { kind: 'end', id: arrival.id }))
  arrivals.delete(view)
  startLargePaste(view, arrival.markdown, arrival.parse, context)
}

/** Escape: cancels a paste landing, dismisses one that failed; otherwise not the paste's. */
export function escapeLargePaste(view: EditorView, context: LargePasteContext): boolean {
  const pending = pasteKey.getState(view.state)
  if (pending == null || pending.state === 'landed') return false
  abandon(view, context, pending.state === 'landing')
  return true
}

/**
 * The writer's own edit while a paste lands joins the paste's history group,
 * so one undo takes the paste away whatever was typed meanwhile.
 */
export function joinLandingPaste(view: EditorView, tr: Transaction): void {
  const arrival = arrivals.get(view)
  if (arrival?.root === undefined || !tr.docChanged || !isPasteLanding(view.state)) return
  if (tr.getMeta(pasteKey) !== undefined || isHistoryTransaction(tr)) return
  if (tr.getMeta('addToHistory') === false || tr.getMeta('appendedTransaction') !== undefined)
    return
  tr.setMeta('appendedTransaction', arrival.root)
  arrival.joined = true
}

/** Stops a paste arriving, and forgets it. */
function stop(view: EditorView, arrival: Arrival): void {
  arrival.abort.abort()
  clearTimeout(arrival.settle)
  if (arrivals.get(view) === arrival) arrivals.delete(view)
}

/** The editor is going away: the paste goes with it. */
export function endLargePaste(view: EditorView): void {
  const arrival = arrivals.get(view)
  if (arrival !== undefined) stop(view, arrival)
}
