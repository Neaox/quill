import { Facet, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import type { EditorState, Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'
import type { DecorationSet, PluginValue, ViewUpdate } from '@codemirror/view'
import type { SupportedLanguage, TokenClass, TokenRange } from '@quill/highlight'
import { createRangesRegistry, placeRanges } from '@quill/highlight/client'
import type {
  HighlightClientEnvironment,
  TextSegment,
  TokenHighlightRegistry,
} from '@quill/highlight/client'
import { TOKEN_CLASSES, TOKEN_CLASS_PREFIX } from '@quill/highlight/tokens'

/**
 * A code block's syntax colours while it is written: the reader's tokenizer,
 * the reader's ranges, painted the reader's way (ADR-030).
 *
 * The block is tokenized by `@quill/highlight`'s `tokenize` — the Prism
 * grammars the server tokenizes a published block with — so the editor and
 * the reader colour the same characters with the same classes, from the one
 * language registry. Where the browser has the CSS Custom Highlight API the
 * ranges are painted as the reader paints them: `StaticRange`s over the text
 * nodes of the lines CodeMirror has drawn, added to the page-global
 * `Highlight` per token class (`@quill/highlight/client`). Nothing is added to
 * the DOM per token. CodeMirror redraws lines as the block is edited and
 * scrolled, so the ranges are rebuilt after every redraw and never held across
 * one. Only where that API is missing are the same ranges drawn as
 * `Decoration.mark` spans with the reader's `tok-*` classes.
 *
 * The ranges live in a `DecorationSet` in either case, because that is what
 * CodeMirror maps through an edit cheaply: between keystrokes the colours move
 * with the text they belong to, and the block is tokenized again once per
 * frame rather than once per keystroke. A block larger than the reader would
 * embed waits a little longer, because there is no tokenizing worker yet and
 * the main thread is the typist's.
 *
 * The grammars are a chunk of their own, loaded the first time a block asks
 * for colour, so opening the editor costs nothing until code is on screen.
 */

/** What tokenizes a block: `@quill/highlight`'s `tokenize`, or a test's. */
export type Tokenize = (text: string, language: SupportedLanguage) => readonly TokenRange[]

/** The tokenizer, which may still be on its way. */
export interface TokenizerSource {
  /** The tokenizer, once it has loaded. */
  current(): Tokenize | undefined
  /** Loads it, once however often it is asked. */
  load(): Promise<Tokenize>
}

/** A tokenizer loaded on first use and kept. */
export function lazyTokenizer(load: () => Promise<Tokenize>): TokenizerSource {
  let ready: Tokenize | undefined
  let loading: Promise<Tokenize> | undefined
  return {
    current: () => ready,
    load: () => {
      loading ??= load().then((tokenize) => {
        ready = tokenize
        return tokenize
      })
      return loading
    },
  }
}

/** The browser capabilities painting needs: the reader's environment. */
export type PaintEnvironment = Pick<HighlightClientEnvironment, 'CSS' | 'Highlight' | 'createRange'>

/** Runs `work` later and returns what cancels it; `large` asks for a longer wait. */
export type Schedule = (work: () => void, large: boolean) => () => void

/** Above this many characters a block is re-tokenized after a pause rather than every frame. */
export const LARGE_BLOCK_CHARS = 8_192

/** The pause before a large block is re-tokenized: the typist keeps the main thread. */
export const LARGE_BLOCK_DELAY_MS = 150

/** On the next frame, or after `LARGE_BLOCK_DELAY_MS` for a large block. */
export const frameSchedule: Schedule = (work, large) => {
  if (large) {
    const timer = setTimeout(work, LARGE_BLOCK_DELAY_MS)
    return () => {
      clearTimeout(timer)
    }
  }
  const frame = requestAnimationFrame(work)
  return () => {
    cancelAnimationFrame(frame)
  }
}

export interface TokenPaintingOptions {
  /** The grammar key, or undefined for plain text. */
  readonly language: SupportedLanguage | undefined
  readonly tokenizer: TokenizerSource
  readonly environment: PaintEnvironment
  readonly schedule: Schedule
}

/** One mark per class, made once: a set of them maps through edits without allocating. */
const MARKS: ReadonlyMap<TokenClass, Decoration> = new Map(
  TOKEN_CLASSES.map((tokenClass) => [
    tokenClass,
    Decoration.mark({ class: `${TOKEN_CLASS_PREFIX}${tokenClass}` }),
  ]),
)

const CLASS_OF: ReadonlyMap<Decoration, TokenClass> = new Map(
  [...MARKS].map(([tokenClass, mark]) => [mark, tokenClass]),
)

function toDecorations(ranges: readonly TokenRange[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const range of ranges) {
    const mark = MARKS.get(range.type)
    /* v8 ignore else -- MARKS has a mark for every token class a tokenizer can return. */
    if (mark !== undefined) builder.add(range.start, range.end, mark)
  }
  return builder.finish()
}

/** The block's tokens, wherever the field that holds them was configured. */
const blockTokens = Facet.define<DecorationSet, DecorationSet>({
  combine: (sets) => sets[0] ?? Decoration.none,
})

/** Fresh tokens for the block's current text. */
const retokenized = StateEffect.define<DecorationSet>()

function tokensOf(
  state: EditorState,
  language: SupportedLanguage | undefined,
  tokenize: Tokenize | undefined,
): DecorationSet {
  if (language === undefined || tokenize === undefined) return Decoration.none
  return toDecorations(tokenize(state.doc.toString(), language))
}

/** The ranges a block is painted with between `from` and `to`, in order. */
export function paintedRanges(state: EditorState, from = 0, to = state.doc.length): TokenRange[] {
  const ranges: TokenRange[] = []
  state.facet(blockTokens).between(from, to, (start, end, mark) => {
    const type = CLASS_OF.get(mark)
    /* v8 ignore else -- the facet holds only marks made from MARKS. */
    if (type !== undefined) ranges.push({ start, end, type })
  })
  return ranges
}

/** The text nodes CodeMirror has drawn, each with where it sits in the block. */
function drawnText(view: EditorView): TextSegment[] {
  const walker = view.contentDOM.ownerDocument.createTreeWalker(
    view.contentDOM,
    NodeFilter.SHOW_TEXT,
  )
  const segments: TextSegment[] = []
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    /* v8 ignore else -- a SHOW_TEXT walker yields only text nodes; the check narrows the type. */
    if (node instanceof Text) segments.push({ node, start: view.posAtDOM(node, 0) })
  }
  return segments
}

/** What a block that has painted nothing yet takes down. */
const nothingToDispose = (): void => undefined

/** Paints a block's ranges into the page's `Highlight`s, again after every redraw. */
function rangesPainter(registry: TokenHighlightRegistry, environment: PaintEnvironment): Extension {
  return ViewPlugin.define((initial) => {
    let dispose = nothingToDispose
    let live = true
    const paint = (view: EditorView): void => {
      if (!live) return
      dispose()
      const { from, to } = view.viewport
      dispose = registry.applyRanges(
        (piece) => environment.createRange(piece.node, piece.from, piece.to),
        placeRanges(drawnText(view), paintedRanges(view.state, from, to)),
      )
    }
    // A plugin is made before CodeMirror draws its lines — when the block
    // opens, and when a language change reconfigures it — so the first paint
    // waits for the drawing, which is done by the end of this task.
    queueMicrotask(() => {
      paint(initial)
    })
    const painter: PluginValue = {
      // New tokens over an unchanged drawing are painted now; anything that
      // redraws lines is painted once it has, in `docViewUpdate`.
      update: (update: ViewUpdate) => {
        const fresh = update.startState.facet(blockTokens) !== update.state.facet(blockTokens)
        if (fresh && !update.docChanged && !update.viewportChanged) paint(update.view)
      },
      docViewUpdate: paint,
      destroy: () => {
        live = false
        dispose()
      },
    }
    return painter
  })
}

/** Tokenizes the block again after an edit, once per frame, and once the grammars arrive. */
function retokenizer(options: TokenPaintingOptions): Extension {
  const { language, tokenizer, schedule } = options
  return ViewPlugin.define((initial) => {
    let cancel: (() => void) | undefined
    let live = true
    const refresh = (view: EditorView): void => {
      cancel = undefined
      view.dispatch({
        effects: retokenized.of(tokensOf(view.state, language, tokenizer.current())),
      })
    }
    if (language !== undefined && tokenizer.current() === undefined) {
      void tokenizer.load().then(() => {
        if (live) refresh(initial)
      })
    }
    return {
      update: (update: ViewUpdate) => {
        if (!update.docChanged || language === undefined || cancel !== undefined) return
        const large = update.state.doc.length > LARGE_BLOCK_CHARS
        cancel = schedule(() => {
          refresh(update.view)
        }, large)
      },
      destroy: () => {
        live = false
        cancel?.()
      },
    }
  })
}

/**
 * Colours a block in `language`, the reader's way. Reconfigured, rather than
 * rebuilt, when the block's language changes: the new field tokenizes as it
 * is created, so the change is coloured in the same transaction.
 */
export function tokenPainting(options: TokenPaintingOptions): Extension {
  const { language, tokenizer, environment } = options
  const tokens = StateField.define<DecorationSet>({
    create: (state) => tokensOf(state, language, tokenizer.current()),
    update: (value, transaction) => {
      for (const effect of transaction.effects) {
        if (effect.is(retokenized)) return effect.value
      }
      return transaction.docChanged ? value.map(transaction.changes) : value
    },
    provide: (field) => blockTokens.from(field),
  })
  const registry = createRangesRegistry(environment)
  return [
    tokens,
    registry === null ? EditorView.decorations.from(tokens) : rangesPainter(registry, environment),
    retokenizer(options),
  ]
}
