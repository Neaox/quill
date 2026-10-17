/**
 * Where the draw.io editor is served from (ADR-043, "Where the editor runs").
 *
 * The server half of the draw.io extension is this module: the editor's
 * address, the CSP `frame-src` it implies, the route that tells the web app,
 * and the label reader for search (`drawing-text.ts`).
 *
 * The default is a **self-hosted** draw.io — the `jgraph/drawio` image,
 * Apache 2.0 — on its own origin, so a diagram never leaves the instance.
 * `docker-compose.yml` runs one at `http://localhost:8080/` for development,
 * which is the default here only while the app itself is on loopback; a real
 * deployment states `DRAWIO_URL`, or has no draw.io editor (diagrams still
 * read, they just cannot be edited in Quill).
 *
 * diagrams.net's hosted editor is an explicit opt-in, because it sends every
 * diagram opened in it to a third party: naming it in `DRAWIO_URL` refuses to
 * boot unless `DRAWIO_ALLOW_THIRD_PARTY=true` says so too.
 */

export interface DrawioEditorConfig {
  /** The editor page, which the web app opens in embed mode. */
  readonly url: string
  /** Its origin: the CSP's `frame-src`, and the only origin messages are accepted from. */
  readonly origin: string
  /** True when the editor is diagrams.net's, which receives every diagram opened in it. */
  readonly thirdParty: boolean
}

export interface DrawioConfig {
  /** Null when this instance offers no draw.io editor. */
  readonly editor: DrawioEditorConfig | null
}

export const DEVELOPMENT_DRAWIO_URL = 'http://localhost:8080/'

/** Hosts that are diagrams.net's own, and so a third party to this instance. */
const THIRD_PARTY_HOSTS = /(?:^|\.)(?:diagrams\.net|draw\.io|drawio\.com)$/i

export function loadDrawioConfig(
  env: NodeJS.ProcessEnv,
  development: boolean,
  appOrigin: string,
): DrawioConfig {
  const raw = env['DRAWIO_URL'] ?? (development ? DEVELOPMENT_DRAWIO_URL : '')
  if (raw === '' || raw === 'off') return { editor: null }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`DRAWIO_URL must be an absolute URL, received "${raw}"`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`DRAWIO_URL must be http or https, received "${raw}"`)
  }
  if (url.protocol === 'http:' && !development) {
    throw new Error(
      'DRAWIO_URL must be https outside development: the editor frame carries diagrams.',
    )
  }

  // The frame runs with `allow-scripts allow-same-origin`, which is safe only
  // while it is another origin than the app's: on the same one it could lift
  // its own sandbox and act as the reader.
  if (url.origin === appOrigin && env['DRAWIO_URL'] === undefined) {
    // The development default, on an app that took its port: no editor,
    // rather than a refusal of a value nobody wrote.
    return { editor: null }
  }
  if (url.origin === appOrigin) {
    throw new Error(
      'DRAWIO_URL must be on its own origin, not the app’s: serve draw.io from another host or port.',
    )
  }
  const thirdParty = THIRD_PARTY_HOSTS.test(url.hostname)
  if (thirdParty && env['DRAWIO_ALLOW_THIRD_PARTY'] !== 'true') {
    throw new Error(
      `DRAWIO_URL names ${url.hostname}, which sends every diagram opened in it to diagrams.net. ` +
        'Self-host the jgraph/drawio image instead, or set DRAWIO_ALLOW_THIRD_PARTY=true to accept that.',
    )
  }
  return { editor: { url: url.href, origin: url.origin, thirdParty } }
}

/** The origins the app's CSP lets it frame for draw.io: the editor's, or none. */
export function drawioFrameSources(config: DrawioConfig): readonly string[] {
  return config.editor === null ? [] : [config.editor.origin]
}
