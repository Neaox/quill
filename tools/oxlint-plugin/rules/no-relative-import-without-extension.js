/**
 * quill/no-relative-import-without-extension
 *
 * Relative imports carry their `.ts`/`.tsx` extension, because native type
 * stripping resolves modules exactly the way Node does: it does not guess
 * an extension (ADR-025, AGENTS.md rule 5).
 *
 * Heuristic: a relative specifier (starting with `./` or `../`) that ends
 * in some extension — `.ts`, `.tsx`, `.js`, `.json`, `.css`, or a
 * multi-part one such as `.gen.ts` or `.gen.d.ts` — is already correct and
 * is left alone; the `*.gen.*` naming convention (AGENTS.md rule 11a) is
 * just a normal extension as far as this check is concerned, so
 * `'./schema.gen.d.ts'` passes untouched. Only a specifier with no
 * extension at all is a violation.
 *
 * Covers static imports/exports (`import`, `export ... from`) and dynamic
 * `import()`.
 *
 * Auto-fixes by checking the filesystem, relative to the importing file's
 * directory, in this order: `<spec>.ts`, `<spec>.tsx`, `<spec>/index.ts`,
 * `<spec>/index.tsx`. The fix is applied only when exactly one of those
 * exists on disk, so the fixer never guesses between a same-named `.ts` and
 * `.tsx` file or invents a path that isn't real.
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const HAS_EXTENSION = /\.[^./]+$/
const CANDIDATES = ['.ts', '.tsx', '/index.ts', '/index.tsx']

function findFix(context, specifier) {
  const fromDir = dirname(context.filename)
  const matches = CANDIDATES.filter((candidate) => existsSync(join(fromDir, specifier + candidate)))
  return matches.length === 1 ? matches[0] : null
}

function checkSource(context, sourceNode) {
  if (!sourceNode || typeof sourceNode.value !== 'string') return
  const specifier = sourceNode.value
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return
  if (HAS_EXTENSION.test(specifier)) return

  const suffix = findFix(context, specifier)
  context.report({
    node: sourceNode,
    message: 'Add the file extension to this relative import; native type stripping requires it.',
    fix: suffix
      ? (fixer) => {
          const quote = sourceNode.raw[0]
          return fixer.replaceText(sourceNode, `${quote}${specifier}${suffix}${quote}`)
        }
      : undefined,
  })
}

const rule = {
  meta: {
    type: 'problem',
    fixable: 'code',
    docs: { description: 'require explicit extensions on relative imports' },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        checkSource(context, node.source)
      },
      ExportNamedDeclaration(node) {
        checkSource(context, node.source)
      },
      ExportAllDeclaration(node) {
        checkSource(context, node.source)
      },
      ImportExpression(node) {
        checkSource(context, node.source)
      },
    }
  },
}

export default rule
