/**
 * Bytes to text for a fetched page (ADR-042): the character set comes from the
 * `content-type` header, else a `<meta>` tag near the top, else UTF-8.
 *
 * The page is read as bytes because the charset is not known until the header,
 * or the first kilobyte of markup, has been seen. An unknown or malformed label
 * is not an error, since a mislabelled page is still a page: it falls through
 * to the next source. Decoding never throws on bad bytes; they become U+FFFD.
 */

const META_SNIFF_BYTES = 1024
const META_CHARSET = /<meta[^>]+charset\s*=\s*["']?\s*([\w:.-]+)/i

type Decoder = InstanceType<typeof TextDecoder>

function decoderFor(label: string | null | undefined): Decoder | null {
  if (label === null || label === undefined) return null
  try {
    return new TextDecoder(label)
  } catch {
    // `RangeError`: the label names no encoding this runtime knows.
    return null
  }
}

/** `latin1` maps every byte to a code point, so it reads ASCII markup losslessly. */
function sniffMetaCharset(bytes: Uint8Array): string | null {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, META_SNIFF_BYTES))
  return META_CHARSET.exec(head)?.[1] ?? null
}

export function decodeHtml(bytes: Uint8Array, headerCharset: string | null): string {
  const decoder =
    decoderFor(headerCharset) ?? decoderFor(sniffMetaCharset(bytes)) ?? new TextDecoder('utf-8')
  return decoder.decode(bytes)
}
