/**
 * quill/no-brand-literal
 *
 * The project's code name never appears as a literal outside `packages/brand`
 * (plan section 6); code that needs it imports `BRAND` from `@quill/brand`
 * instead so a rename touches one package.
 *
 * Heuristic: flags string literals and template-literal chunks that contain
 * the whole word "quill" (case-insensitive) once every `@quill/<package>`
 * substring has been removed from the text first. That second part matters:
 * an npm-scoped package reference — `'@quill/domain'` as an import
 * specifier, but just as much `'pnpm --filter @quill/web dev'` in a
 * Playwright config or `` `written from @quill/theme` `` in a generated-file
 * banner — names a package, not the brand, and this codebase refers to its
 * own packages by name in plenty of places that are not import statements.
 * A bare `quill` outside that shape (a display string, a title, prose) is
 * still flagged.
 *
 * Identifiers, type names, and file paths are never in scope — only literal
 * text a user or a script could read, per the spec's "as a literal".
 *
 * The `packages/brand/**` and `scripts/rename.ts` exemptions, and the
 * carve-out for test and e2e-support files (which legitimately use `quill`
 * as a Postgres user/database name, a temp-directory prefix, and similar
 * fixture-only technical identifiers — the script this rule replaces never
 * scanned test files at all), are configured as `.oxlintrc.json` overrides
 * rather than baked into the rule, so the rule itself stays a simple, total
 * check.
 *
 * No auto-fix: replacing a literal with `BRAND.name` (or similar) changes
 * the surrounding expression in ways that are not safe to guess.
 */

const BRAND_WORD = /\bquill\b/i
const SCOPED_PACKAGE_REFERENCE = /@quill\/[\w.-]+/gi

/** Strips `@quill/<package>` references, which name a package, not the brand. */
function withoutPackageReferences(text) {
  return text.replace(SCOPED_PACKAGE_REFERENCE, '')
}

/** True when `literalNode` is the module specifier of an import/export/require/import(). */
function isModuleSpecifier(literalNode) {
  const parent = literalNode.parent
  if (!parent) return false
  if (
    (parent.type === 'ImportDeclaration' ||
      parent.type === 'ExportNamedDeclaration' ||
      parent.type === 'ExportAllDeclaration' ||
      parent.type === 'ImportExpression') &&
    parent.source === literalNode
  ) {
    return true
  }
  if (
    parent.type === 'CallExpression' &&
    parent.callee.type === 'Identifier' &&
    parent.callee.name === 'require' &&
    parent.arguments[0] === literalNode
  ) {
    return true
  }
  return false
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'disallow the project code name as a literal outside packages/brand',
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value !== 'string') return
        if (isModuleSpecifier(node)) return
        if (!BRAND_WORD.test(withoutPackageReferences(node.value))) return
        context.report({
          node,
          message:
            'Import BRAND from the brand package instead of writing the code name as a literal.',
        })
      },
      TemplateElement(node) {
        const text = node.value.cooked ?? node.value.raw
        if (!BRAND_WORD.test(withoutPackageReferences(text))) return
        context.report({
          node,
          message:
            'Import BRAND from the brand package instead of writing the code name as a literal.',
        })
      },
    }
  },
}

export default rule
