import { promisify } from 'node:util'
import { inflateRaw } from 'node:zlib'

import type { DrawingText } from '@quill/application'
import { readDrawioLabels } from '@quill/markdown/drawio'
import type { Inflate } from '@quill/markdown/drawio'

/**
 * The draw.io reader behind the `DrawingText` port (ADR-043): a diagram's
 * labels, from the source a `.drawio.svg` or `.drawio` carries, for search.
 *
 * The format is `@quill/markdown/drawio`'s to read; what this adapter adds is
 * the one thing the Markdown package cannot do portably, which is inflate.
 * zlib is told the cap itself (`maxOutputLength`), so a zip bomb is stopped by
 * the inflater at the cap rather than discovered after it has been paid for,
 * and inflating runs off the event loop.
 */

const inflateRawAsync = promisify(inflateRaw)

/** zlib's code for output past `maxOutputLength`. */
const BUFFER_TOO_LARGE = 'ERR_BUFFER_TOO_LARGE'

/** A thrown value's `code`, or undefined for one that has none (`Object` boxes a primitive). */
function errorCode(error: unknown): unknown {
  return Reflect.get(Object(error), 'code')
}

export const zlibInflate: Inflate = async (compressed, maxBytes) => {
  try {
    const bytes = await inflateRawAsync(compressed, { maxOutputLength: Math.max(1, maxBytes) })
    return { kind: 'inflated', bytes }
  } catch (error) {
    return {
      kind: 'refused',
      reason: errorCode(error) === BUFFER_TOO_LARGE ? 'too-large' : 'malformed',
    }
  }
}

export function createDrawioText(inflate: Inflate = zlibInflate): DrawingText {
  return {
    async read(file) {
      const read = await readDrawioLabels(file, inflate)
      return read.kind === 'labels' && read.labels.length > 0 ? read.labels.join('\n') : null
    },
  }
}
