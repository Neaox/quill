/* v8 ignore start -- runs in a child process, where this runner's coverage cannot see it;
   `image-pipeline.test.ts` drives it through the real fork and checks every outcome. */
import { createSharpTranscoder } from './sharp-transcoder.ts'
import type { ImageSpec, TranscodedImage } from './image-transcoder.ts'

/**
 * The child process `isolated-transcoder.ts` keeps in its pool.
 *
 * It answers one job at a time, in the order they arrive, and holds no
 * credentials and no state between them beyond what the codec itself keeps. The
 * parent decides how long it lives: it is killed on any failure, replaced after
 * a number of images, and stopped when idle. If a malformed image makes libvips
 * crash or spin, the parent sees the process end and the server carries on.
 *
 * It ends when its parent goes away, so a server that stops uncleanly leaves no
 * decoder behind.
 */

export interface TranscodeJob {
  readonly bytes: Uint8Array
  readonly spec: ImageSpec
}

export type TranscodeReply =
  | ({ readonly ok: true } & TranscodedImage)
  | { readonly ok: false; readonly message: string }

function isJob(message: unknown): message is TranscodeJob {
  return typeof message === 'object' && message !== null && 'bytes' in message && 'spec' in message
}

function main(): void {
  const send = process.send?.bind(process)
  if (send === undefined) return

  const transcoder = createSharpTranscoder()
  process.on('disconnect', () => process.exit(0))
  process.on('message', async (message: unknown) => {
    if (!isJob(message)) {
      send({ ok: false, message: 'Malformed job' } satisfies TranscodeReply, () => process.exit(1))
      return
    }
    let reply: TranscodeReply
    try {
      reply = { ok: true, ...(await transcoder.transcode(message.bytes, message.spec)) }
    } catch (error) {
      reply = { ok: false, message: String(error) }
    }
    send(reply)
  })
}

main()
/* v8 ignore stop */
