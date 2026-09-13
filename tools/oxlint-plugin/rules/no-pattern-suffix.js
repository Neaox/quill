/**
 * quill/no-pattern-suffix
 *
 * No *type-level or PascalCase* identifier ends in `Port`, `Strategy`,
 * `Impl`, `Manager`, or `Helper`, and no file is named `utils`, `helpers`,
 * or `misc` (`docs/architecture/patterns.md`: the pattern catalogue names
 * ports, adapters, and strategies without those words ever appearing in a
 * type name, and utility code lives where it reads naturally instead of a
 * dumping ground).
 *
 * Heuristic: checks the suffix only at binding positions — class, function,
 * interface, and type-alias names, and `const`/`let`/`var` declarators bound
 * to a plain identifier — not at every reference, so one bad name is
 * reported once instead of once per call site. Destructuring patterns are
 * skipped since there is no single name to rename. Class, interface, and
 * type-alias names are always checked, since those are always type-level.
 * Function and variable bindings are checked only when the name is
 * PascalCase (its first character is uppercase): `ContentStorePort` and
 * `RetryStrategy` are banned, but `parsePort`, `serverPort`, and
 * `listenPort` are camelCase English for a TCP port number, not the
 * hexagonal "port" pattern, so they are left alone. The file-name check
 * compares the file's base name (before the first dot, so `utils.test.ts`
 * is also caught) case-sensitively against the three banned names.
 *
 * No auto-fix: renaming a binding requires updating every reference and
 * import, which is not safe to do blindly.
 */

import { basename } from 'node:path'

const BANNED_SUFFIX = /(Port|Strategy|Impl|Manager|Helper)$/
const BANNED_FILE_NAMES = new Set(['utils', 'helpers', 'misc'])

function isPascalCase(name) {
  return /^[A-Z]/.test(name)
}

function reportIfBanned(context, node, name) {
  if (!BANNED_SUFFIX.test(name)) return
  context.report({
    node,
    message: `Rename `.concat(
      name,
      '; identifiers may not end in Port, Strategy, Impl, Manager, or Helper (docs/architecture/patterns.md).',
    ),
  })
}

/** Function and variable bindings are only pattern-level when PascalCase; see the doc comment above. */
function reportIfBannedAndPascalCase(context, node, name) {
  if (!isPascalCase(name)) return
  reportIfBanned(context, node, name)
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'disallow pattern-name suffixes on identifiers and banned utility file names',
    },
  },
  create(context) {
    return {
      Program() {
        const base = basename(context.filename).split('.')[0]
        if (BANNED_FILE_NAMES.has(base)) {
          context.report({
            loc: { start: { line: 1, column: 0 } },
            message: `Rename this file; \`utils\`, \`helpers\`, and \`misc\` are not allowed file names — put the code where it reads naturally.`,
          })
        }
      },
      ClassDeclaration(node) {
        if (node.id) reportIfBanned(context, node.id, node.id.name)
      },
      ClassExpression(node) {
        if (node.id) reportIfBanned(context, node.id, node.id.name)
      },
      FunctionDeclaration(node) {
        if (node.id) reportIfBannedAndPascalCase(context, node.id, node.id.name)
      },
      TSInterfaceDeclaration(node) {
        reportIfBanned(context, node.id, node.id.name)
      },
      TSTypeAliasDeclaration(node) {
        reportIfBanned(context, node.id, node.id.name)
      },
      VariableDeclarator(node) {
        if (node.id.type === 'Identifier') {
          reportIfBannedAndPascalCase(context, node.id, node.id.name)
        }
      },
    }
  },
}

export default rule
