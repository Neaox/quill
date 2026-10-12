import type { Inflate } from '@quill/markdown/drawio'

/**
 * Raw inflate in the browser, for opening a compressed draw.io source in the
 * editor (`editableDrawioSource`): the platform's `DecompressionStream`,
 * read chunk by chunk and cancelled the moment the output passes the cap, so
 * a hostile file costs the cap and no more — the same rule the server's zlib
 * adapter keeps.
 */
export const browserInflate: Inflate = async (compressed, maxBytes) => {
  const input = new ReadableStream<BufferSource>({
    start(controller) {
      // A copy on an ordinary `ArrayBuffer`, which is what a stream may carry.
      controller.enqueue(new Uint8Array(compressed))
      controller.close()
    },
  })
  const output = input.pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = output.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > maxBytes) {
        await reader.cancel()
        return { kind: 'refused', reason: 'too-large' }
      }
      chunks.push(value)
    }
  } catch {
    return { kind: 'refused', reason: 'malformed' }
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return { kind: 'inflated', bytes }
}
