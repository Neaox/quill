// First, so the Markdown pipeline finds a document when it loads.
import { standInInstalled } from './worker-document.ts'
import { answerParse } from './markdown-parser.ts'
import type { ParseRequest } from './markdown-parser.ts'

/**
 * The module worker a large paste is parsed in (`markdown-parser.ts`). It
 * holds the Markdown pipeline and nothing else, and answers each request in
 * the order it came.
 */

// Read, so the import is kept; and first, so the stand-in exists before the pipeline loads.
void standInInstalled

addEventListener('message', (event: MessageEvent<ParseRequest>) => {
  postMessage(answerParse(event.data))
})
