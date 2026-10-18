import { EditorView } from '@codemirror/view'
import { createRangesRegistry } from '@quill/highlight/client'
import type { TokenHighlightRegistry } from '@quill/highlight/client'
import { codeBlockStyles } from '@quill/ui'

import { pageIdleQueue } from '../document/idle-queue.ts'
import type { IdleQueue } from '../document/idle-queue.ts'
import { createCodeMirror, pagePainting } from './code-mirror.ts'
import type { CodeMirrorHost, CodeMirrorOptions } from './code-mirror.ts'
import type { EditorLanguage } from './languages.ts'

/**
 * A code block's CodeMirror, built when it is wanted (P1-15 in
 * docs/research/2026-10-11-editor-vs-confluence.md; quill-plan.md section 31).
 *
 * A long runbook holds hundreds of code blocks, and a live CodeMirror is
 * several milliseconds to build and a measuring pass on every frame after:
 * pasting one such document built 240 of them in the paste's own task, and the
 * page stayed busy measuring them for seconds. So a block starts as what the
 * reader shows — a static `<pre>`, framed by the design system's `CodeBlock`
 * slots and coloured with the reader's ranges — and becomes a live editor
 * when it comes near the screen, in idle time, or at once when the writer
 * reaches for it: a press, the focus, the caret arriving by arrow key, the
 * copy button. The host has CodeMirror's shape (`CodeMirrorHost`), so the node
 * view around it does not know which of the two it is talking to.
 *
 * When a block is opened is a strategy (`CodeMirrorMounting`): near the
 * viewport in a browser, and at once where there is no layout to say what is
 * near — jsdom, or a browser without `IntersectionObserver`.
 */

/** What a mounting strategy is told about one block. */
export interface WatchedBlock {
  /** Colours the static block; cheap, and worth doing first. */
  paint(): void
  /** Builds the live editor. */
  open(): void
}

/** When blocks are opened. */
export interface CodeMirrorMounting {
  /** Starts watching a static block; returns what stops watching it. */
  watch(element: Element, block: WatchedBlock): () => void
}

/** What there is to undo before anything has been done. */
const nothing = (): void => undefined

/** Every block opened as it is drawn: the behaviour where nothing can say what is near. */
export const eagerMounting: CodeMirrorMounting = {
  watch: (_element, block) => {
    block.open()
    return nothing
  },
}

/** How far outside the viewport a block counts as near: half a screen either way. */
const NEAR = '50% 0px'

/**
 * Blocks opened once they come within half a screen of the viewport, in the
 * page's idle time: every near block is coloured before any is opened, so what
 * is on screen looks right first and becomes editable a moment later.
 */
export function viewportMounting(
  queue: IdleQueue,
  Observer: typeof IntersectionObserver,
): CodeMirrorMounting {
  const waiting = new Map<Element, WatchedBlock>()
  const scheduled = new Map<Element, readonly (() => void)[]>()
  let observer: IntersectionObserver | undefined

  const seen: IntersectionObserverCallback = (entries) => {
    for (const { target, isIntersecting } of entries) {
      const block = isIntersecting ? waiting.get(target) : undefined
      if (block === undefined) continue
      waiting.delete(target)
      observer?.unobserve(target)
      scheduled.set(target, [
        queue.schedule(block.paint, 'visible'),
        queue.schedule(block.open, 'background'),
      ])
    }
  }

  return {
    watch(element, block) {
      observer ??= new Observer(seen, { rootMargin: NEAR })
      waiting.set(element, block)
      observer.observe(element)
      return () => {
        waiting.delete(element)
        observer?.unobserve(element)
        for (const cancel of scheduled.get(element) ?? []) cancel()
        scheduled.delete(element)
      }
    },
  }
}

let mounting: CodeMirrorMounting | undefined

/** The page's strategy, chosen the first time a block is drawn. */
export function pageMounting(): CodeMirrorMounting {
  mounting ??=
    typeof IntersectionObserver === 'undefined'
      ? eagerMounting
      : viewportMounting(pageIdleQueue(), IntersectionObserver)
  return mounting
}

/**
 * Replaces the page's strategy, undefined meaning the default again; returns
 * what puts the previous one back. For a test environment with no layout to
 * watch, and for a test of the lazy behaviour itself.
 */
export function setCodeMirrorMounting(next: CodeMirrorMounting | undefined): () => void {
  const previous = mounting
  mounting = next
  return () => {
    mounting = previous
  }
}

/** Opens a static block, so what reaches for its editor finds one. */
const opening = new WeakMap<Element, () => CodeMirrorHost>()

/**
 * The editor of the code block inside `container`, opening it if it is still
 * static; null when there is no block. For a code group, whose tabs are
 * blocks it does not own.
 */
export function codeMirrorIn(container: Element | undefined): EditorView | null {
  const editor = container?.querySelector<HTMLElement>('.cm-editor')
  if (editor !== null && editor !== undefined) return EditorView.findFromDOM(editor)
  const block = container?.querySelector('pre[data-code-static]')
  const open = block === null || block === undefined ? undefined : opening.get(block)
  return open?.().view ?? null
}

export interface LazyCodeMirrorOptions extends CodeMirrorOptions {
  /** The page's strategy unless a test supplies its own. */
  readonly mounting?: CodeMirrorMounting
  /**
   * Told once, when the block first comes near the screen or is opened,
   * whichever is first: the moment the rest of the block's furniture (its
   * language picker, a React root apiece) is worth building. A paste of
   * hundreds of blocks builds none of it up front.
   */
  onWanted?(): void
}

export interface LazyCodeMirrorHost extends CodeMirrorHost {
  /** Whether the live editor has been built. Reading `view` builds it. */
  readonly mounted: boolean
}

const frame = codeBlockStyles()

/** Where a press landed in the static text, where the browser can say. */
function offsetOf(code: HTMLElement, event: PointerEvent): number {
  if (!('caretPositionFromPoint' in document)) return 0
  const position = document.caretPositionFromPoint(event.clientX, event.clientY)
  return position?.offsetNode.parentNode === code ? position.offset : 0
}

export function createLazyCodeMirror(options: LazyCodeMirrorOptions): LazyCodeMirrorHost {
  let { text, language, editable } = options
  const painting = options.painting ?? pagePainting()
  let live: CodeMirrorHost | undefined
  let destroyed = false

  // The reader's block: the `CodeBlock` component's `<pre>` and `<code>`
  // slots, the code set in from the frame's edge by the width of
  // CodeMirror's line numbers, so nothing moves sideways when it opens.
  const pre = document.createElement('pre')
  pre.className = frame.pre({ className: 'code-block-static ps-11' })
  pre.dataset['codeStatic'] = ''
  pre.setAttribute('contenteditable', 'false')
  pre.tabIndex = -1
  const code = document.createElement('code')
  code.className = frame.code()
  code.textContent = text
  pre.append(code)
  options.parent.append(pre)

  let registry: TokenHighlightRegistry | null | undefined
  let unpaint = nothing
  let painted = false
  let wanted = false

  const want = (): void => {
    if (wanted) return
    wanted = true
    options.onWanted?.()
  }

  /** Colours the static block with the reader's ranges, over its one text node. */
  const paint = (): void => {
    want()
    unpaint()
    unpaint = nothing
    painted = true
    const grammar = language?.grammar
    if (destroyed || live !== undefined || grammar === undefined) return
    registry ??= createRangesRegistry(painting.environment)
    // Without the Highlight API the block stays plain until it opens, which
    // is soon: only blocks near the screen are painted at all.
    if (registry === null) return
    const tokenize = painting.tokenizer.current()
    if (tokenize === undefined) {
      void painting.tokenizer.load().then(paint)
      return
    }
    const node = code.firstChild
    if (!(node instanceof Text)) return
    const { environment } = painting
    unpaint = registry.applyRanges(
      (range) => environment.createRange(node, range.start, range.end),
      tokenize(text, grammar),
    )
  }

  let stopWatching = nothing

  const open = (): CodeMirrorHost => {
    if (live !== undefined) return live
    want()
    stopWatching()
    unpaint()
    pre.remove()
    opening.delete(pre)
    live = createCodeMirror({ ...options, text, language, editable, painting })
    return live
  }

  opening.set(pre, open)
  pre.addEventListener('focus', () => {
    open().view.focus()
  })
  pre.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    const offset = offsetOf(code, event)
    const { view } = open()
    view.dispatch({ selection: { anchor: offset } })
    view.focus()
  })
  stopWatching = (options.mounting ?? pageMounting()).watch(pre, {
    paint,
    open: () => {
      open()
    },
  })

  return {
    get mounted() {
      return live !== undefined
    },
    get view() {
      return open().view
    },
    // The node view tells the host its text and language on every update of
    // the block; only a real change is worth painting again.
    setText(next: string) {
      if (live !== undefined) {
        live.setText(next)
        return
      }
      if (next === text) return
      text = next
      code.textContent = next
      if (painted) paint()
    },
    setLanguage(next: EditorLanguage | undefined) {
      const changed = next?.grammar !== language?.grammar
      language = next
      if (live !== undefined) live.setLanguage(next)
      else if (painted && changed) paint()
    },
    setEditable(next: boolean) {
      editable = next
      live?.setEditable(next)
    },
    destroy() {
      destroyed = true
      stopWatching()
      unpaint()
      live?.destroy()
    },
  }
}
