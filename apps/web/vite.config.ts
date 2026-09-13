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
  ],
  build: {
    // Powers `scripts/check-bundle.ts` (quill-plan.md section 31): it reads
    // `dist/.vite/manifest.json` to resolve each route's static import graph
    // without guessing chunk names from hashed filenames.
    manifest: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
})
