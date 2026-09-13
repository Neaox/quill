/**
 * Architectural dependency rules.
 *
 * Dependency direction:  UI -> Features -> Application -> Domain <- Infrastructure
 *
 * These rules are the mechanical enforcement of the layering described in
 * quill-plan.md, section 7. They run as part of `pnpm check`.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-depends-on-nothing',
      comment: 'The domain package must not import any other workspace package or framework.',
      severity: 'error',
      from: { path: '^packages/domain/src' },
      to: {
        path: '^(packages/(?!domain)|apps/)',
        pathNot: '^packages/domain',
      },
    },
    {
      name: 'domain-is-framework-free',
      comment: 'No React, Fastify, Drizzle, or provider SDKs in the domain.',
      severity: 'error',
      from: { path: '^packages/domain/src' },
      to: { path: 'node_modules/(react|fastify|drizzle-orm|@octokit|pg)' },
    },
    {
      name: 'application-depends-only-on-domain',
      comment:
        'Application services may depend on the domain and declared interfaces, never on infrastructure implementations.',
      severity: 'error',
      from: { path: '^packages/application/src' },
      to: { path: '^(packages/(content-store|search|providers|ui|api-client)|apps/)' },
    },
    {
      name: 'search-imports-application-types-only',
      comment:
        'The search core declares no port of its own: it re-exports the one in the application layer. Those imports must stay type-only, so nothing of the application layer is pulled into the core at runtime and its tests still run without standing one up.',
      severity: 'error',
      from: { path: '^packages/search/src' },
      to: { path: '^packages/application', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'web-does-not-import-server',
      severity: 'error',
      from: { path: '^apps/web' },
      to: { path: '^apps/server' },
    },
    {
      name: 'server-does-not-import-web',
      severity: 'error',
      from: { path: '^apps/server' },
      to: { path: '^apps/web' },
    },
    {
      name: 'web-does-not-touch-infrastructure',
      comment: 'The web app talks to the server through the generated API client only.',
      severity: 'error',
      from: { path: '^apps/web/src' },
      to: { path: '^packages/(content-store|search|providers)/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)vite-env\\.d\\.ts$',
          '\\.test\\.tsx?$',
          '(^|/)main\\.tsx?$',
          '(^|/)[^/]+\\.config\\.ts$',
          '(^|/)vitest\\.setup\\.ts$',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['node_modules', 'dist', 'coverage', '\\.gen\\.ts$'] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
}
