// First, so the Markdown pipeline finds a document when it loads. It is imported for
// its effect, which only holds if it evaluates before `markdown-parser.ts`.
// oxlint-disable-next-line import/no-unassigned-import
import './worker-document.ts'
import { answerParse } from './markdown-parser.ts'
import type { ParseRequest } from './markdown-parser.ts'

/**
 * The module worker a large paste is parsed in (`markdown-parser.ts`). It
 * holds the Markdown pipeline and nothing else, and answers each request in
 * the order it came.
 */
addEventListener('message', (event: MessageEvent<ParseRequest>) => {
  postMessage(answerParse(event.data))
})
