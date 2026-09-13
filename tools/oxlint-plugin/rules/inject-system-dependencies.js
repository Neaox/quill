/**
 * quill/inject-system-dependencies
 *
 * `Date.now()`, `new Date()` with no arguments, `crypto.randomUUID()`, and
 * `Math.random()` are non-deterministic system dependencies; production
 * code asks for a `Clock` or `IdGenerator` port instead of calling the
 * global directly (ADR-021, `ports/system.ts`).
 *
 * This rule flags every call unconditionally — the "only in the
 * infrastructure adapters that implement `Clock`/`IdGenerator`, and in
 * tests" carve-out is a matter of *where* the call is allowed, not what the
 * call looks like, so it is expressed as `.oxlintrc.json` overrides
 * (`apps/server/src/infrastructure/system-clock.ts`,
 * `apps/server/src/infrastructure/uuid-generator.ts`, `**\/*.test.*`,
 * `**\/test-support/**`, `**\/testing/**`, `scripts/**`) rather than
 * hard-coded paths in the rule.
 *
 * `new Date(someArgument)` is not flagged: given an explicit input it is a
 * pure conversion, not a read of the current time.
 *
 * Beyond the plain globals, the same call reaches the runtime through two
 * other doors this rule also closes:
 *
 * - `globalThis.` prefixed access (`globalThis.Date.now()`,
 *   `globalThis.crypto.randomUUID()`, `globalThis.Math.random()`,
 *   `new globalThis.Date()`) is the same global, just spelled out in full.
 * - `node:crypto`/`crypto` named imports bring `randomUUID` in as a local
 *   binding — `import { randomUUID } from 'node:crypto'` then
 *   `randomUUID()` — including through an alias
 *   (`import { randomUUID as uuid } from 'node:crypto'`) and through the
 *   `webcrypto` namespace (`import { webcrypto } from 'node:crypto'` then
 *   `webcrypto.randomUUID()`). The import is tracked by local binding name,
 *   so a call only matches once it is textually reachable from the
 *   import — the same single-pass assumption every other tracker in this
 *   plugin makes. `randomBytes` is a separate, deterministic-enough-to-seed
 *   primitive and is deliberately left untouched.
 *
 * No auto-fix: introducing a `Clock`/`IdGenerator` dependency is an
 * architectural change, not a mechanical rewrite.
 */

const CRYPTO_MODULES = new Set(['crypto', 'node:crypto'])

/** True when `node` is the identifier chain `path` (e.g. `['globalThis', 'crypto', 'randomUUID']`). */
function matchesPath(node, path) {
  if (path.length === 1) {
    return node.type === 'Identifier' && node.name === path[0]
  }
  return (
    node.type === 'MemberExpression' &&
    !node.computed &&
    node.property.type === 'Identifier' &&
    node.property.name === path[path.length - 1] &&
    matchesPath(node.object, path.slice(0, -1))
  )
}

function matchesAny(node, paths) {
  return paths.some((path) => matchesPath(node, path))
}

const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'require Clock/IdGenerator ports instead of direct system calls' },
  },
  create(context) {
    // Local bindings introduced by `import { randomUUID, webcrypto } from 'node:crypto' | 'crypto'`,
    // keyed by local name (so an alias is tracked under its local spelling), valued by which
    // system dependency the binding stands in for.
    const cryptoImports = new Map()

    return {
      ImportDeclaration(node) {
        if (typeof node.source.value !== 'string' || !CRYPTO_MODULES.has(node.source.value)) return
        for (const specifier of node.specifiers) {
          if (specifier.type !== 'ImportSpecifier') continue
          const importedName =
            specifier.imported.type === 'Identifier'
              ? specifier.imported.name
              : specifier.imported.value
          if (importedName === 'randomUUID' || importedName === 'webcrypto') {
            cryptoImports.set(specifier.local.name, importedName)
          }
        }
      },
      CallExpression(node) {
        if (
          matchesAny(node.callee, [
            ['Date', 'now'],
            ['globalThis', 'Date', 'now'],
          ])
        ) {
          context.report({
            node,
            message: 'Inject a Clock instead of calling Date.now() directly.',
          })
          return
        }

        if (
          matchesAny(node.callee, [
            ['crypto', 'randomUUID'],
            ['globalThis', 'crypto', 'randomUUID'],
          ])
        ) {
          context.report({
            node,
            message: 'Inject an IdGenerator instead of calling crypto.randomUUID() directly.',
          })
          return
        }

        if (
          matchesAny(node.callee, [
            ['Math', 'random'],
            ['globalThis', 'Math', 'random'],
          ])
        ) {
          context.report({
            node,
            message: 'Inject an IdGenerator instead of calling Math.random() directly.',
          })
          return
        }

        // A local binding from `import { randomUUID } from 'node:crypto'` (aliases included),
        // called directly: `randomUUID()` / `uuid()`.
        if (
          node.callee.type === 'Identifier' &&
          cryptoImports.get(node.callee.name) === 'randomUUID'
        ) {
          context.report({
            node,
            message: 'Inject an IdGenerator instead of calling randomUUID() directly.',
          })
          return
        }

        // `webcrypto.randomUUID()` through a local binding from
        // `import { webcrypto } from 'node:crypto'` (aliases included).
        if (
          node.callee.type === 'MemberExpression' &&
          !node.callee.computed &&
          node.callee.object.type === 'Identifier' &&
          cryptoImports.get(node.callee.object.name) === 'webcrypto' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'randomUUID'
        ) {
          context.report({
            node,
            message: 'Inject an IdGenerator instead of calling webcrypto.randomUUID() directly.',
          })
        }
      },
      NewExpression(node) {
        if (
          matchesAny(node.callee, [['Date'], ['globalThis', 'Date']]) &&
          node.arguments.length === 0
        ) {
          context.report({
            node,
            message: 'Inject a Clock instead of calling `new Date()` directly.',
          })
        }
      },
    }
  },
}

export default rule
