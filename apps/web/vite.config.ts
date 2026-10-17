import { connect } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

import { BRAND } from '@quill/brand'

/** Replaces the `%BRAND_NAME%` placeholder in `index.html` at build and dev time. */
function htmlBrandPlugin(): Plugin {
  return {
    name: 'html-brand',
    transformIndexHtml(html) {
      return html.replaceAll('%BRAND_NAME%', BRAND.name)
    },
  }
}

/** The API server. A Playwright run points this at its own (`e2e/support/env.ts`). */
const API_URL = process.env['API_URL'] ?? 'http://localhost:3000'

/**
 * What the dev server proxies to the API. Beside the API itself, the
 * server-rendered surfaces (`docs/architecture/public-site.md`): the public
 * site and the reader preview are pages the server answers with HTML, so in
 * development they are proxied like the API rather than falling through to
 * the single-page app.
 */
const API_PATHS = ['/api', '/s/', '/preview/', '/robots.txt']

/**
 * How often, and how many times, a proxied request looks for a restarting API
 * before it is let through to fail: thirty seconds in all, because the API
 * takes up to fifteen to start.
 */
const API_POLL_MS = 250
const API_POLLS = 120

/**
 * Holds a proxied request while the API restarts, rather than answering 502.
 *
 * In development the API restarts on every save it imports (`node --watch`),
 * and a request that lands in the second or two before it listens again
 * fails at the proxy: a page that 502s at random. Retrying at the proxy would
 * have to replay request bodies; waiting until the port accepts a connection
 * before the request reaches the proxy needs no replay. A server that is
 * really down still answers 502, once the wait runs out.
 */
function waitForApiPlugin(): Plugin {
  const api = new URL(API_URL)
  const host = api.hostname
  const port = Number(api.port || (api.protocol === 'https:' ? 443 : 80))
  return {
    name: 'wait-for-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (!API_PATHS.some((path) => request.url?.startsWith(path) === true)) {
          next()
          return
        }
        void untilListening(host, port, API_POLLS).then(() => {
          next()
        })
      })
    },
  }
}

async function untilListening(host: string, port: number, polls: number): Promise<void> {
  if (polls === 0 || (await accepts(host, port))) return
  await delay(API_POLL_MS)
  await untilListening(host, port, polls - 1)
}

function accepts(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port })
    const settle = (listening: boolean): void => {
      socket.destroy()
      resolve(listening)
    }
    socket.once('connect', () => {
      settle(true)
    })
    socket.once('error', () => {
      settle(false)
    })
  })
}

/** The design system's modules that nearly every screen uses (see the `ui-base` chunk below). */
const UI_BASE_MODULES = [
  'components/badge.tsx',
  'components/button.tsx',
  'components/callout.tsx',
  'components/icons.tsx',
  'components/layout-grid.tsx',
  'components/local-time.tsx',
  'components/relative-time.tsx',
  'components/scroll-group.tsx',
  'components/spinner.tsx',
  'components/text-link.tsx',
  'components/toast-tone.tsx',
  'components/toast.ts',
  'lib/class-names.ts',
  'lib/link.tsx',
  'lib/time/',
]

/** Module ids use the platform's separator, so compare on forward slashes. */
function isUiBase(moduleId: string): boolean {
  const path = moduleId.replaceAll('\\', '/')
  return UI_BASE_MODULES.some((module) => path.includes(`packages/ui/src/${module}`))
}

export default defineConfig({
  plugins: [
    // Before `react()`, as the plugin requires: it generates
    // `src/routeTree.gen.ts` from `src/routes` and splits each route's
    // component into its own chunk, and both have to happen before React's
    // transform sees the file.
    //
    // Not under Vitest, which extends this config from the repository root
    // (`vitest.config.ts`): the generated tree is committed, so a test run
    // needs neither the generator — whose paths are relative to a root that
    // is not this one — nor the code splitting, which only makes the
    // components a test renders arrive asynchronously for no benefit.
    ...(process.env['VITEST'] === undefined
      ? [
          tanstackRouter({
            target: 'react',
            autoCodeSplitting: true,
            routesDirectory: fileURLToPath(new URL('src/routes', import.meta.url)),
            generatedRouteTree: fileURLToPath(new URL('src/routeTree.gen.ts', import.meta.url)),
          }),
        ]
      : []),
    react(),
    tailwindcss(),
    htmlBrandPlugin(),
    waitForApiPlugin(),
  ],
  build: {
    // Powers `scripts/check-bundle.ts` (quill-plan.md section 31): it reads
    // `dist/.vite/manifest.json` to resolve each route's static import graph
    // without guessing chunk names from hashed filenames.
    manifest: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              // The primitives nearly every screen draws. Left to the automatic
              // split, each is its own tiny chunk shared by whichever route
              // components happen to use it, and a screen pays a request and a
              // gzip header for each; together they compress far better than
              // apart (quill-plan.md section 31: the reading route's budget is
              // measured in gzipped bytes). Radix-backed components stay out,
              // because they are what a route can choose not to load.
              name: 'ui-base',
              test: isUiBase,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // The editor and the presentation are the two heavy route chunks
    // (quill-plan.md section 31), and a dev server transforms a chunk the
    // first time a browser asks for it. Warmed at start-up instead, so the
    // first Edit or Present of a session opens as fast as the second — for a
    // developer, and for a Playwright journey that would otherwise measure a
    // cold transform under four browsers against a ten-second expectation.
    // Absolute, like the router plugin's paths above: Vitest extends this
    // config from the repository root, where a path relative to this file
    // resolves to nothing and is reported as a failed pre-transform.
    warmup: {
      clientFiles: [
        fileURLToPath(
          new URL(
            'src/routes/_authenticated/w/$workspaceSlug/d/$documentId/edit.tsx',
            import.meta.url,
          ),
        ),
        fileURLToPath(
          new URL(
            'src/routes/_authenticated/w/$workspaceSlug_/d/$documentId/present.tsx',
            import.meta.url,
          ),
        ),
      ],
    },
    proxy: Object.fromEntries(
      API_PATHS.map((path) => [path, { target: API_URL, changeOrigin: true }]),
    ),
  },
})
