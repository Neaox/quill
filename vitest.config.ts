import { defineConfig } from 'vitest/config'

/**
 * Root Vitest configuration.
 *
 * Coverage policy (quill-plan.md, section 27): full behavioural coverage on
 * the domain, application, markdown, content-store, search, and server
 * packages; UI packages are measured but gated on behaviour, not lines.
 */
export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        test: {
          name: 'packages',
          environment: 'node',
          include: ['packages/*/src/**/*.test.ts'],
          // Property tests and the content store's real-filesystem contention
          // tests are I/O-bound; on a loaded machine or a two-core CI runner
          // the 5 s default reports them as failures rather than slow.
          testTimeout: 30_000,
          exclude: ['packages/ui/**', 'packages/editor/**'],
        },
      },
      {
        extends: './packages/editor/vite.config.ts',
        test: {
          name: 'editor',
          environment: 'jsdom',
          setupFiles: ['./packages/editor/vitest.setup.ts'],
          include: ['packages/editor/src/**/*.test.{ts,tsx}'],
        },
      },
      {
        extends: './packages/ui/vite.config.ts',
        test: {
          name: 'ui',
          environment: 'jsdom',
          setupFiles: ['./packages/ui/vitest.setup.ts'],
          include: ['packages/ui/src/**/*.test.{ts,tsx}'],
        },
      },
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['apps/server/src/**/*.test.ts'],
          // Integration tests migrate a fresh schema each behind one advisory
          // lock; under a full parallel run that queue alone can pass 5 s.
          testTimeout: 30_000,
        },
      },
      {
        extends: './apps/web/vite.config.ts',
        test: {
          name: 'web',
          environment: 'jsdom',
          setupFiles: ['./apps/web/vitest.setup.ts'],
          include: ['apps/web/src/**/*.test.{ts,tsx}'],
        },
      },
      {
        test: {
          name: 'tools',
          environment: 'node',
          include: ['tools/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'scripts',
          environment: 'node',
          include: ['scripts/**/*.test.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'packages/*/src/**/*.{ts,tsx}',
        'apps/server/src/**/*.ts',
        'apps/web/src/**/*.{ts,tsx}',
      ],
      exclude: [
        '**/*.test.{ts,tsx}',
        // Benchmarks measure; they are not behaviour to cover.
        '**/*.bench.ts',
        '**/*.d.ts',
        '**/*.gen.*',
        '**/index.ts',
        // Composition roots: they wire a process together and hold no logic.
        // What they call is covered where it is defined.
        'apps/server/src/main.ts',
        'apps/server/src/scripts/*-cli.ts',
        'apps/web/src/main.tsx',
        'apps/web/src/app/**',
      ],
      thresholds: {
        'packages/**/src/**/*.{ts,tsx}': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'apps/server/src/**/*.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'apps/web/src/**/*.{ts,tsx}': { statements: 80, branches: 80, functions: 80, lines: 80 },
      },
    },
  },
})
