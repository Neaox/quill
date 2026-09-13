/**
 * `Content-Disposition`, per RFC 6266.
 *
 * A header field is ISO-8859-1 at best and ASCII in practice, and a filename is
 * whatever the person called their file — `設計図.png`, `holiday 🏖.jpg`. RFC
 * 6266 answers that with two parameters carried together:
 *
 * - `filename=` holds an ASCII fallback in a quoted string, for a client that
 *   reads nothing else;
 * - `filename*=` holds the real name, as RFC 5987 encodes it: the charset, an
 *   empty language tag, and the name percent-encoded from its UTF-8 bytes.
 *
 * Every client released this decade prefers `filename*` when both are present,
 * so the fallback is what an old one gets rather than what anybody normally
 * sees. Both are emitted always: choosing between them by inspecting the name
 * would mean two code paths, and the one that is rarely taken is the one that
 * is wrong.
 *
 * Nothing here trusts the name. `safeFilename` has already removed control
 * characters and path separators; this removes what a header's own grammar
 * cannot carry — the quote and the backslash that would end the quoted string
 * early, and the semicolon that would start a parameter of somebody else's
 * choosing.
 */

/** What a quoted string cannot hold without ending itself or escaping. */
const UNQUOTABLE = /["\\;]/gu

/** Everything outside printable US-ASCII, which a header field cannot carry. */
const NOT_ASCII_PRINTABLE = /[^\u0020-\u007E]/gu

/**
 * The characters `encodeURIComponent` leaves alone that RFC 5987's `ext-value`
 * does not allow.
 *
 * `encodeURIComponent` percent-encodes everything except `!`, `'`, `(`, `)`,
 * `*`, `-`, `.`, `_` and `~`; the grammar allows only the last four of those,
 * so the first five are encoded here. All five are ASCII, which is why the
 * encoding below needs no fallback for a character it cannot place.
 */
const RESERVED = /['()*!]/gu

/**
 * The ASCII fallback: anything unprintable or non-ASCII becomes `_`, so the
 * name still reads as a name rather than as mojibake, and the characters the
 * grammar reserves are removed rather than escaped.
 */
export function asciiFallback(filename: string): string {
  const flattened = filename.replaceAll(UNQUOTABLE, '').replaceAll(NOT_ASCII_PRINTABLE, '_').trim()
  return flattened === '' ? 'attachment' : flattened
}

/** The name as RFC 5987's `ext-value`: `UTF-8''` and the percent-encoded bytes. */
export function extendedValue(filename: string): string {
  const encoded = encodeURIComponent(filename).replaceAll(
    RESERVED,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `UTF-8''${encoded}`
}

export type Disposition = 'inline' | 'attachment'

export function contentDisposition(disposition: Disposition, filename: string): string {
  return `${disposition}; filename="${asciiFallback(filename)}"; filename*=${extendedValue(filename)}`
}
