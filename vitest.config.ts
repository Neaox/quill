import { defineConfig } from 'vitest/config'

/**
 * Root Vitest configuration.
 *
 * Coverage policy (quill-plan.md, section 27): full behavioural coverage on
 * the domain, application, markdown, content-store, search, and server
 * packages; UI packages are measured but gated on behaviour, not lines.
 */

/**
 * What a test and a hook are given before they are called failures, stated
 * once and shared by every project, because a project does not inherit the
 * root's test options.
 *
 * Vitest's defaults are five seconds and ten. Several hundred files run in
 * parallel here, under v8 coverage, against a real Postgres, a real
 * filesystem, and jsdom: property tests and the content store's contention
 * tests are I/O-bound, every integration suite migrates a fresh schema behind
 * one advisory lock, and a web route test renders a code-split chunk and then
 * drives a form a keystroke at a time. On a loaded machine or a two-core CI
 * runner the defaults report those as failures rather than as slow. These
 * budgets still catch a test that has actually hung.
 */
const BUDGET = { testTimeout: 30_000, hookTimeout: 60_000 } as const

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        test: {
          name: 'packages',
          environment: 'node',
          include: ['packages/*/src/**/*.test.ts'],
          exclude: ['packages/ui/**', 'packages/editor/**'],
          ...BUDGET,
        },
      },
      {
        extends: './packages/editor/vite.config.ts',
        test: {
          name: 'editor',
          environment: 'jsdom',
          setupFiles: ['./packages/editor/vitest.setup.ts'],
          include: ['packages/editor/src/**/*.test.{ts,tsx}'],
          ...BUDGET,
        },
      },
      {
        extends: './packages/ui/vite.config.ts',
        test: {
          name: 'ui',
          environment: 'jsdom',
          setupFiles: ['./packages/ui/vitest.setup.ts'],
          include: ['packages/ui/src/**/*.test.{ts,tsx}'],
          ...BUDGET,
        },
      },
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['apps/server/src/**/*.test.ts'],
          ...BUDGET,
        },
      },
      {
        extends: './apps/web/vite.config.ts',
        test: {
          name: 'web',
          environment: 'jsdom',
          setupFiles: ['./apps/web/vitest.setup.ts'],
          include: ['apps/web/src/**/*.test.{ts,tsx}'],
          ...BUDGET,
        },
      },
      {
        test: {
          name: 'tools',
          environment: 'node',
          include: ['tools/**/*.test.ts'],
          ...BUDGET,
        },
      },
      {
        test: {
          name: 'scripts',
          environment: 'node',
          include: ['scripts/**/*.test.ts'],
          ...BUDGET,
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
