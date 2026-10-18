/**
 * An animation's frames, read by the uploader's own browser, so a poster
 * frame can be chosen in the upload preview (ADR-047, "The resting frame is
 * the still").
 *
 * The server never decodes a frame (`animation.ts` in `@quill/application`):
 * it cuts a GIF's or an APNG's first frame from the container, which is the
 * default still. Any other frame is composited from the ones before it, and
 * that needs a codec — the browser's. So the browser draws the chosen frame
 * through WebCodecs' `ImageDecoder` and a canvas, as a PNG, and that PNG is
 * uploaded as the still like any other emoji image: sniffed, stripped and
 * stored by the same route.
 *
 * GIF and APNG only. An animated WebP or AVIF has no still until the image
 * pipeline derives one, and plays as uploaded until then. Where the browser
 * has no `ImageDecoder`, or cannot decode the type, there is nothing to
 * choose from and the first frame stays the still.
 */
export interface AnimationFrames {
  readonly count: number
  /** One frame, counted from nought, drawn as a PNG. */
  readonly frame: (index: number) => Promise<Blob>
  readonly close: () => void
}

/** What reading frames needs of the browser; the platform's own unless a test gives another. */
export interface FramePlatform {
  readonly ImageDecoder: typeof ImageDecoder | undefined
  readonly toPng: (frame: VideoFrame) => Promise<Blob>
}

/** The types whose still this release can be asked to cut at another frame. */
const TYPES_WITH_POSTERS = new Set(['image/gif', 'image/png'])

async function drawPng(frame: VideoFrame): Promise<Blob> {
  const canvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight)
  canvas.getContext('2d')?.drawImage(frame, 0, 0)
  return canvas.convertToBlob({ type: 'image/png' })
}

function browserPlatform(): FramePlatform {
  return {
    ImageDecoder: typeof ImageDecoder === 'function' ? ImageDecoder : undefined,
    toPng: drawPng,
  }
}

/** The frames of an animated GIF or PNG, or undefined when there is nothing to choose from. */
export async function readAnimationFrames(
  file: File,
  platform: FramePlatform = browserPlatform(),
): Promise<AnimationFrames | undefined> {
  const Decoder = platform.ImageDecoder
  if (Decoder === undefined || !TYPES_WITH_POSTERS.has(file.type)) return undefined
  if (!(await Decoder.isTypeSupported(file.type))) return undefined

  let decoder: ImageDecoder
  try {
    decoder = new Decoder({ data: await file.arrayBuffer(), type: file.type })
    await decoder.tracks.ready
    await decoder.completed
  } catch {
    // A file the browser cannot read is still the server's to judge; it just
    // has no frames to choose from here.
    return undefined
  }
  const count = decoder.tracks.selectedTrack?.frameCount ?? 0
  if (count < 2) {
    decoder.close()
    return undefined
  }
  return {
    count,
    frame: async (index) => {
      const { image } = await decoder.decode({ frameIndex: index })
      try {
        return await platform.toPng(image)
      } finally {
        image.close()
      }
    },
    close: () => {
      decoder.close()
    },
  }
}
