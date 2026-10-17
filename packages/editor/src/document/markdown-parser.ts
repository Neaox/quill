import { parseDocument } from '@quill/markdown/parse'

import type { DocumentAst } from '../document-ast.ts'

/**
 * Where a large paste's Markdown is parsed (quill-plan.md section 31: a paste
 * never freezes the tab).
 *
 * Parsing is the one step of a paste that grows with the clipboard and cannot
 * be cut into pieces: micromark reads a 4,000-line runbook in about a third of
 * a second, and ten thousand lines of plain text in most of one. Done in the
 * page, that is a frozen tab. Done in a module worker, the page keeps
 * answering keystrokes and only the conversion to editor nodes — a tenth of
 * the cost — is the page's.
 *
 * A port with two adapters (`docs/architecture/patterns.md`): a worker where
 * the browser has workers, and the page itself where it has none (jsdom), or
 * where the worker fails — a worker that cannot be built, cannot parse, or
 * dies hands its work back to the page rather than losing a paste.
 */

/** Parses a clipboard's Markdown into the AST the editor converts. */
export type ParseMarkdown = (markdown: string) => Promise<DocumentAst>

export interface ParseRequest {
  readonly id: number
  readonly markdown: string
}

export type ParseResponse =
  | { readonly id: number; readonly ast: DocumentAst }
  | { readonly id: number; readonly error: string }

/** What the worker does with a request: the parse, or why there is none. */
export function answerParse(request: ParseRequest): ParseResponse {
  try {
    return { id: request.id, ast: parseDocument(request.markdown).ast }
  } catch (error) {
    return { id: request.id, error: String(error) }
  }
}

/** Parses in the page, after the current task: the slow path, with nowhere better to go. */
export function inThreadParser(): ParseMarkdown {
  return (markdown) =>
    new Promise((resolve) => {
      setTimeout(() => {
        resolve(parseDocument(markdown).ast)
      }, 0)
    })
}

/** The slice of a `Worker` the parser uses. */
export interface WorkerLike {
  /** A dedicated worker has no origin to name; the options carry transfers, and there are none. */
  postMessage(request: ParseRequest, options: StructuredSerializeOptions): void
  addEventListener(type: 'message', listener: (event: MessageEvent<ParseResponse>) => void): void
  addEventListener(type: 'error', listener: () => void): void
  terminate(): void
}

/** Parses in a worker built on first use, falling back to the page on any failure. */
export function workerParser(create: () => WorkerLike): ParseMarkdown {
  const fallback = inThreadParser()
  const waiting = new Map<number, { readonly markdown: string; resolve(ast: DocumentAst): void }>()
  let worker: WorkerLike | undefined
  let next = 0

  const settle = (id: number, ast: Promise<DocumentAst>): void => {
    const request = waiting.get(id)
    waiting.delete(id)
    void ast.then((value) => request?.resolve(value))
  }

  const started = (): WorkerLike => {
    const made = create()
    made.addEventListener('message', ({ data }) => {
      const request = waiting.get(data.id)
      if (request === undefined) return
      settle(data.id, 'ast' in data ? Promise.resolve(data.ast) : fallback(request.markdown))
    })
    made.addEventListener('error', () => {
      made.terminate()
      worker = undefined
      for (const [id, request] of waiting) settle(id, fallback(request.markdown))
    })
    return made
  }

  return (markdown) => {
    try {
      worker ??= started()
    } catch {
      return fallback(markdown)
    }
    const id = next++
    const { promise, resolve } = Promise.withResolvers<DocumentAst>()
    waiting.set(id, { markdown, resolve })
    worker.postMessage({ id, markdown }, {})
    return promise
  }
}

/** The module worker, written the way the bundler recognises and splits into its own chunk. */
function createParseWorker(): WorkerLike {
  return new Worker(new URL('./markdown-parse.worker.ts', import.meta.url), { type: 'module' })
}

let page: ParseMarkdown | undefined

/** The page's parser: one worker for every editor on it, or the page where there are no workers. */
export function pageMarkdownParser(): ParseMarkdown {
  if (typeof Worker === 'undefined') return inThreadParser()
  page ??= workerParser(createParseWorker)
  return page
}
