import type { PreviewEmbed } from './link-preview.ts'

/**
 * The embed allowlist (ADR-042, "Embeds are an allowlist"): the only places a
 * Quill page may put a live frame.
 *
 * A provider is a code-defined entry, reviewed like any other change, never a
 * setting an author can add to. It owns three things that must agree:
 *
 * - **Which pages it recognises.** By host, compared exactly, then by path
 *   segments and validated identifiers. There are no regular expressions over
 *   the path as a whole, so a hostile address cannot make a match backtrack.
 * - **The frame it builds.** The frame's address is assembled by us from the
 *   validated parts (a video id, a document key), never copied from the page's
 *   own markup or from an oEmbed `html` field. A page cannot choose where the
 *   frame points.
 * - **What the frame may do.** The `sandbox` and `allow` tokens, and the
 *   origins the page's CSP `frame-src` names so the browser agrees.
 *
 * The CSP is generated from this list, so adding a provider here is the one
 * change that widens what the app may frame (`registry.frameSources()`).
 *
 * Pure and dependency-free so the resolver builds frames with it, the server
 * derives the CSP from it, and the renderer re-checks what it was handed.
 *
 * Pattern: registry (docs/architecture/patterns.md). Each entry is a strategy
 * for one provider; `createEmbedRegistry` is the view an instance has of it
 * after the operator's choices.
 */

/**
 * The shapes a frame can hold its place in. A closed set, so the stylesheet
 * names each one: the Content-Security-Policy forbids an inline `style`, which
 * is how an arbitrary ratio would otherwise have to be written.
 */
export const EMBED_RATIOS = {
  '7:3': 7 / 3,
  '16:9': 16 / 9,
  '16:10': 16 / 10,
  '4:3': 4 / 3,
  '1:1': 1,
  '9:10': 9 / 10,
} as const

export type EmbedRatioName = keyof typeof EMBED_RATIOS

const RATIO_NAMES = Object.keys(EMBED_RATIOS).filter(
  (name): name is EmbedRatioName => name in EMBED_RATIOS,
)

/** The closest named shape to a ratio, as the token the stylesheet and the markup agree on. */
export function nearestEmbedRatio(aspectRatio: number): EmbedRatioName {
  let best: EmbedRatioName = '16:9'
  for (const name of RATIO_NAMES) {
    if (Math.abs(EMBED_RATIOS[name] - aspectRatio) < Math.abs(EMBED_RATIOS[best] - aspectRatio)) {
      best = name
    }
  }
  return best
}

export interface EmbedFrame {
  /** An absolute https address on one of the provider's `frameOrigins`. */
  readonly src: string
  /** Width over height; always one of `EMBED_RATIOS`. */
  readonly aspectRatio: number
}

export interface EmbedProvider {
  /** Stable and lower-case: what an operator names to disable it, and what a stored preview records. */
  readonly id: string
  /** Shown to readers: "YouTube". */
  readonly name: string
  /** Page hosts it recognises, exact and lower-case. */
  readonly hosts: readonly string[]
  /** The origins its frames live on: the CSP's `frame-src`. */
  readonly frameOrigins: readonly string[]
  /** The `sandbox` tokens. Always a short list, and never `allow-top-navigation`. */
  readonly sandbox: readonly string[]
  /** The `allow` (Permissions Policy) features the frame needs; empty means none. */
  readonly allow: readonly string[]
  /**
   * Why the frame needs `allow-same-origin`, when it does, and null when it does
   * not. The frames are on another origin than ours, so the token gives the
   * provider its own origin's storage and nothing of ours; it is still stated,
   * because it is the token a reviewer must be able to justify.
   */
  readonly sameOriginReason: string | null
  /** The frame for a page of this provider, or null when the address is not one it embeds. */
  frameFor(url: URL): EmbedFrame | null
}

// ---------------------------------------------------------------------------
// Reading an address, without a pattern that can backtrack
// ---------------------------------------------------------------------------

const MAX_SEGMENT = 200
const MAX_SEGMENTS = 12

/** The non-empty path segments, or an empty list for a path too strange to be one of ours. */
function segments(url: URL): readonly string[] {
  const parts = url.pathname.split('/').filter((part) => part !== '')
  if (parts.length > MAX_SEGMENTS || parts.some((part) => part.length > MAX_SEGMENT)) return []
  return parts
}

/** A character test per code unit: linear in the input and with nothing to backtrack into. */
function isMadeOf(value: string, allowed: (code: number) => boolean): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (!allowed(value.charCodeAt(index))) return false
  }
  return value.length > 0
}

const isDigit = (code: number) => code >= 48 && code <= 57
const isLower = (code: number) => code >= 97 && code <= 122
const isUpper = (code: number) => code >= 65 && code <= 90
const isLetterOrDigit = (code: number) => isDigit(code) || isLower(code) || isUpper(code)
const isHex = (code: number) => isDigit(code) || (code >= 97 && code <= 102)
/** The unreserved set Google, YouTube and Miro identifiers are written in. */
const isTokenCharacter = (code: number) => isLetterOrDigit(code) || code === 45 || code === 95
const isMiroCharacter = (code: number) => isTokenCharacter(code) || code === 61

/** An identifier of exactly or within a length, in a stated alphabet. */
function identifier(
  value: string | undefined,
  alphabet: (code: number) => boolean,
  min: number,
  max = min,
): string | null {
  if (value === undefined || value.length < min || value.length > max) return null
  return isMadeOf(value, alphabet) ? value : null
}

function frame(src: string, ratio: EmbedRatioName): EmbedFrame {
  return { src, aspectRatio: EMBED_RATIOS[ratio] }
}

// ---------------------------------------------------------------------------
// The providers
// ---------------------------------------------------------------------------

/** Tokens most players need to run at all; narrowed per entry when they need less. */
const PLAYER_SANDBOX = ['allow-scripts', 'allow-same-origin', 'allow-presentation'] as const
const APP_SANDBOX = ['allow-scripts', 'allow-same-origin'] as const

const YOUTUBE_PATHS: ReadonlySet<string> = new Set(['shorts', 'embed', 'live'])

const youtube: EmbedProvider = {
  id: 'youtube',
  name: 'YouTube',
  hosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'],
  // youtube-nocookie.com is the privacy-enhanced origin: it sets no tracking cookie until play.
  frameOrigins: ['https://www.youtube-nocookie.com'],
  sandbox: PLAYER_SANDBOX,
  allow: ['encrypted-media', 'picture-in-picture', 'fullscreen'],
  sameOriginReason:
    'The player reads its own origin’s storage for playback settings and refuses to start without it; the frame is on youtube-nocookie.com, so it gains nothing of ours.',
  frameFor(url) {
    const parts = segments(url)
    let id: string | undefined
    if (url.hostname === 'youtu.be') id = parts.length === 1 ? parts[0] : undefined
    else if (parts.length === 1 && parts[0] === 'watch') id = url.searchParams.get('v') ?? undefined
    else if (parts.length === 2 && YOUTUBE_PATHS.has(parts[0] ?? '')) {
      id = parts[1]
    }
    const video = identifier(id, isTokenCharacter, 11)
    return video === null ? null : frame(`https://www.youtube-nocookie.com/embed/${video}`, '16:9')
  },
}

const vimeo: EmbedProvider = {
  id: 'vimeo',
  name: 'Vimeo',
  hosts: ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'],
  frameOrigins: ['https://player.vimeo.com'],
  sandbox: PLAYER_SANDBOX,
  allow: ['picture-in-picture', 'fullscreen'],
  sameOriginReason:
    'The player keeps its quality and volume choices in its own origin’s storage and does not run without it; the frame is on player.vimeo.com, so it gains nothing of ours.',
  frameFor(url) {
    const parts = segments(url)
    const onPlayer = url.hostname === 'player.vimeo.com'
    // The player's own form is `/video/<id>?h=<hash>`; a page's is `/<id>` or `/<id>/<hash>`.
    if (onPlayer ? parts.length !== 2 || parts[0] !== 'video' : parts.length > 2) return null
    const video = identifier(parts[onPlayer ? 1 : 0], isDigit, 1, 12)
    if (video === null) return null
    // An unlisted video carries a hash in its address, which the player needs to open it.
    const given = onPlayer ? (url.searchParams.get('h') ?? undefined) : parts[1]
    const hash = identifier(given, isHex, 6, 16)
    if (given !== undefined && hash === null) return null
    const query = hash === null ? '' : `?h=${hash}`
    return frame(`https://player.vimeo.com/video/${video}${query}`, '16:9')
  },
}

const loom: EmbedProvider = {
  id: 'loom',
  name: 'Loom',
  hosts: ['loom.com', 'www.loom.com'],
  frameOrigins: ['https://www.loom.com'],
  sandbox: PLAYER_SANDBOX,
  allow: ['fullscreen'],
  sameOriginReason:
    'The recording player stores its session and playback state in its own origin and fails without it; the frame is on loom.com, so it gains nothing of ours.',
  frameFor(url) {
    const [kind, id, ...rest] = segments(url)
    const recording = identifier(id, isHex, 32)
    if ((kind !== 'share' && kind !== 'embed') || recording === null || rest.length > 0) return null
    return frame(`https://www.loom.com/embed/${recording}`, '16:9')
  },
}

const FIGMA_KINDS: ReadonlySet<string> = new Set([
  'file',
  'design',
  'proto',
  'board',
  'slides',
  'deck',
])

const figma: EmbedProvider = {
  id: 'figma',
  name: 'Figma',
  hosts: ['figma.com', 'www.figma.com'],
  frameOrigins: ['https://www.figma.com'],
  sandbox: APP_SANDBOX,
  allow: ['fullscreen'],
  sameOriginReason:
    'The viewer is a full web app that needs its own origin’s storage to load a file; the frame is on figma.com, so it gains nothing of ours.',
  frameFor(url) {
    const [kind, key] = segments(url)
    const file = identifier(key, isLetterOrDigit, 10, 40)
    if (kind === undefined || !FIGMA_KINDS.has(kind) || file === null) return null
    // Figma's own embed endpoint takes the file's address as a parameter. It is rebuilt here
    // from the validated kind and key, so nothing else in the pasted address reaches the frame.
    const target = encodeURIComponent(`https://www.figma.com/${kind}/${file}`)
    return frame(`https://www.figma.com/embed?embed_host=embed&url=${target}`, '16:9')
  },
}

const GOOGLE_DOC_ID_LENGTH = { min: 20, max: 100 } as const

/** Google's two address forms: a file by id, or a published copy (`/d/e/<key>`). */
function googleTarget(
  url: URL,
  section: string,
): { readonly published: boolean; readonly id: string } | null {
  const [first, d, ...rest] = segments(url)
  if (first !== section || d !== 'd') return null
  const [maybePublished, second] = rest
  if (maybePublished === 'e') {
    const key = identifier(second, isTokenCharacter, 10, 120)
    return key === null ? null : { published: true, id: key }
  }
  const id = identifier(
    maybePublished,
    isTokenCharacter,
    GOOGLE_DOC_ID_LENGTH.min,
    GOOGLE_DOC_ID_LENGTH.max,
  )
  return id === null ? null : { published: false, id }
}

const GOOGLE_SAME_ORIGIN =
  'Google’s viewer is a web app that fails to load without its own origin’s storage; the frame is on a google.com origin, so it gains nothing of ours.'

const googleDocs: EmbedProvider = {
  id: 'google-docs',
  name: 'Google Docs',
  hosts: ['docs.google.com'],
  frameOrigins: ['https://docs.google.com'],
  sandbox: APP_SANDBOX,
  allow: [],
  sameOriginReason: GOOGLE_SAME_ORIGIN,
  frameFor(url) {
    const target = googleTarget(url, 'document')
    if (target === null) return null
    const base = `https://docs.google.com/document/d/${target.published ? 'e/' : ''}${target.id}`
    return frame(target.published ? `${base}/pub?embedded=true` : `${base}/preview`, '4:3')
  },
}

const googleSlides: EmbedProvider = {
  id: 'google-slides',
  name: 'Google Slides',
  hosts: ['docs.google.com'],
  frameOrigins: ['https://docs.google.com'],
  sandbox: [...APP_SANDBOX, 'allow-presentation'],
  allow: ['fullscreen'],
  sameOriginReason: GOOGLE_SAME_ORIGIN,
  frameFor(url) {
    const target = googleTarget(url, 'presentation')
    if (target === null) return null
    const base = `https://docs.google.com/presentation/d/${target.published ? 'e/' : ''}${target.id}`
    return frame(`${base}/embed`, '16:9')
  },
}

const googleSheets: EmbedProvider = {
  id: 'google-sheets',
  name: 'Google Sheets',
  hosts: ['docs.google.com'],
  frameOrigins: ['https://docs.google.com'],
  sandbox: APP_SANDBOX,
  allow: [],
  sameOriginReason: GOOGLE_SAME_ORIGIN,
  frameFor(url) {
    const target = googleTarget(url, 'spreadsheets')
    if (target === null) return null
    const base = `https://docs.google.com/spreadsheets/d/${target.published ? 'e/' : ''}${target.id}`
    return frame(
      target.published ? `${base}/pubhtml?widget=true&headers=false` : `${base}/preview`,
      '16:10',
    )
  },
}

const googleDrive: EmbedProvider = {
  id: 'google-drive',
  name: 'Google Drive',
  hosts: ['drive.google.com'],
  frameOrigins: ['https://drive.google.com'],
  sandbox: APP_SANDBOX,
  allow: ['fullscreen'],
  sameOriginReason: GOOGLE_SAME_ORIGIN,
  frameFor(url) {
    const parts = segments(url)
    const [first, second, third] = parts
    if (first === 'file' && second === 'd') {
      const id = identifier(
        third,
        isTokenCharacter,
        GOOGLE_DOC_ID_LENGTH.min,
        GOOGLE_DOC_ID_LENGTH.max,
      )
      return id === null ? null : frame(`https://drive.google.com/file/d/${id}/preview`, '4:3')
    }
    if (first === 'drive' && second === 'folders') {
      const id = identifier(
        third,
        isTokenCharacter,
        GOOGLE_DOC_ID_LENGTH.min,
        GOOGLE_DOC_ID_LENGTH.max,
      )
      return id === null
        ? null
        : frame(`https://drive.google.com/embeddedfolderview?id=${id}#list`, '4:3')
    }
    return null
  },
}

const miro: EmbedProvider = {
  id: 'miro',
  name: 'Miro',
  hosts: ['miro.com', 'www.miro.com'],
  frameOrigins: ['https://miro.com'],
  sandbox: APP_SANDBOX,
  allow: ['fullscreen'],
  sameOriginReason:
    'The board viewer is a full web app that needs its own origin’s storage to load; the frame is on miro.com, so it gains nothing of ours.',
  frameFor(url) {
    const [app, board, id] = segments(url)
    const key = identifier(id, isMiroCharacter, 8, 64)
    if (app !== 'app' || board !== 'board' || key === null) return null
    return frame(`https://miro.com/app/live-embed/${key}/`, '16:9')
  },
}

const SPOTIFY_KINDS: ReadonlySet<string> = new Set([
  'track',
  'album',
  'playlist',
  'episode',
  'show',
  'artist',
])
const SPOTIFY_COMPACT_KINDS: ReadonlySet<string> = new Set(['track', 'episode'])

const spotify: EmbedProvider = {
  id: 'spotify',
  name: 'Spotify',
  hosts: ['open.spotify.com'],
  frameOrigins: ['https://open.spotify.com'],
  sandbox: APP_SANDBOX,
  allow: ['encrypted-media', 'fullscreen'],
  sameOriginReason:
    'The player stores its session and playback state in its own origin and does not run without it; the frame is on open.spotify.com, so it gains nothing of ours.',
  frameFor(url) {
    const parts = segments(url)
    // `/intl-fr/album/…`: a locale prefix is not part of what is being linked to.
    const [kind, id, ...rest] = parts[0]?.startsWith('intl-') === true ? parts.slice(1) : parts
    const item = identifier(id, isLetterOrDigit, 22)
    if (kind === undefined || !SPOTIFY_KINDS.has(kind) || item === null || rest.length > 0) {
      return null
    }
    return frame(
      `https://open.spotify.com/embed/${kind}/${item}`,
      SPOTIFY_COMPACT_KINDS.has(kind) ? '7:3' : '16:10',
    )
  },
}

const LINKEDIN_POST_KINDS: ReadonlySet<string> = new Set(['share', 'ugcPost', 'activity'])

/** The post kind and number in `urn:li:activity:123…`, or null. */
function linkedInUrn(urn: string): { readonly kind: string; readonly id: string } | null {
  const [scheme, namespace, kind, id, ...rest] = urn.split(':')
  const post = identifier(id, isDigit, 10, 25)
  if (scheme !== 'urn' || namespace !== 'li' || rest.length > 0 || post === null) return null
  return kind === undefined || !LINKEDIN_POST_KINDS.has(kind) ? null : { kind, id: post }
}

/** The post a `/posts/<name>_<words>-activity-<number>-<suffix>` address names. */
function linkedInSlug(slug: string): { readonly kind: string; readonly id: string } | null {
  const words = slug.split('-')
  for (let index = 0; index < words.length - 1; index += 1) {
    const kind = words[index]
    if (kind !== undefined && LINKEDIN_POST_KINDS.has(kind)) {
      const id = identifier(words[index + 1], isDigit, 10, 25)
      if (id !== null) return { kind, id }
    }
  }
  return null
}

const linkedin: EmbedProvider = {
  id: 'linkedin',
  name: 'LinkedIn',
  hosts: ['linkedin.com', 'www.linkedin.com'],
  frameOrigins: ['https://www.linkedin.com'],
  sandbox: APP_SANDBOX,
  allow: [],
  sameOriginReason:
    'The embedded post is a LinkedIn page that needs its own origin’s storage to render; the frame is on linkedin.com, so it gains nothing of ours.',
  frameFor(url) {
    const [section, second, third] = segments(url)
    let post: { readonly kind: string; readonly id: string } | null = null
    if (section === 'feed' && second === 'update' && third !== undefined) {
      try {
        post = linkedInUrn(decodeURIComponent(third))
      } catch {
        post = null
      }
    } else if (section === 'posts' && second !== undefined) {
      post = linkedInSlug(second)
    }
    return post === null
      ? null
      : frame(`https://www.linkedin.com/embed/feed/update/urn:li:${post.kind}:${post.id}`, '9:10')
  },
}

/**
 * Every provider this build knows. X is not here by design: its post embed is
 * a script that injects a frame, and the only address that works without the
 * script is an undocumented one. A post from X stays a card.
 */
export const EMBED_PROVIDERS: readonly EmbedProvider[] = [
  youtube,
  vimeo,
  loom,
  figma,
  googleDocs,
  googleSlides,
  googleSheets,
  googleDrive,
  miro,
  spotify,
  linkedin,
]

/** The ids in `ids` that name no provider: a typo in configuration should stop the boot, not widen nothing. */
export function unknownEmbedProviders(ids: readonly string[]): readonly string[] {
  return ids.filter((id) => !EMBED_PROVIDERS.some((provider) => provider.id === id))
}

const MIN_RATIO = 0.5
const MAX_RATIO = 4

export interface EmbedMatch {
  readonly provider: EmbedProvider
  readonly frame: EmbedFrame
}

export interface EmbedRegistry {
  /** The providers this instance has left on. */
  readonly providers: readonly EmbedProvider[]
  /** The provider and frame for a page address, or null when it is not embeddable here. */
  find(url: URL): EmbedMatch | null
  /**
   * The provider a stored embed belongs to, if it still holds: the provider is on, and the
   * frame's address is https, carries no credentials, and lives on one of that provider's
   * own origins. The renderer asks this of every embed it is about to draw, so a stored
   * preview that was altered, or made when a provider was still on, never becomes a frame.
   */
  recognise(embed: PreviewEmbed): EmbedProvider | null
  /** The origins for the CSP `frame-src`, each once; empty when every provider is off. */
  frameSources(): readonly string[]
}

function isPlainHttpsOrigin(url: URL): boolean {
  return url.protocol === 'https:' && url.username === '' && url.password === ''
}

/**
 * The embed allowlist as one instance runs it: every provider except those the
 * operator disabled by id.
 */
export function createEmbedRegistry(disabled: readonly string[]): EmbedRegistry {
  const providers = EMBED_PROVIDERS.filter((provider) => !disabled.includes(provider.id))
  return {
    providers,
    find(url) {
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
      const host = url.hostname
      for (const provider of providers) {
        if (!provider.hosts.includes(host)) continue
        const built = provider.frameFor(url)
        if (built !== null) return { provider, frame: built }
      }
      return null
    },
    recognise(embed) {
      const provider = providers.find(({ id }) => id === embed.provider)
      if (provider === undefined) return null
      if (!(embed.aspectRatio >= MIN_RATIO && embed.aspectRatio <= MAX_RATIO)) return null
      if (!URL.canParse(embed.src)) return null
      const src = new URL(embed.src)
      return isPlainHttpsOrigin(src) && provider.frameOrigins.includes(src.origin) ? provider : null
    },
    frameSources() {
      return [...new Set(providers.flatMap((provider) => provider.frameOrigins))]
    },
  }
}
