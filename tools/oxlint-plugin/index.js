/**
 * The `quill` oxlint plugin: this repository's own standards, expressed as
 * lint rules instead of scripts, so they run in the editor, can auto-fix
 * where safe, and are documented in `docs/architecture/linting.md` next to
 * every other rule. See each file under `rules/` for the rule's exact
 * semantics and the heuristic it uses.
 */
import classnameDiscipline from './rules/classname-discipline.js'
import effectNeedsReason from './rules/effect-needs-reason.js'
import injectSystemDependencies from './rules/inject-system-dependencies.js'
import noBrandLiteral from './rules/no-brand-literal.js'
import noInertControl from './rules/no-inert-control.js'
import noPatternSuffix from './rules/no-pattern-suffix.js'
import noRelativeImportWithoutExtension from './rules/no-relative-import-without-extension.js'
import noSecretInLog from './rules/no-secret-in-log.js'
import noSetStateInEffect from './rules/no-set-state-in-effect.js'
import noStyleProp from './rules/no-style-prop.js'
import preferVariantClassname from './rules/prefer-variant-classname.js'
import taggedTodo from './rules/tagged-todo.js'
import tailwindV4 from './rules/tailwind-v4.js'

export default {
  meta: { name: 'quill' },
  rules: {
    'no-brand-literal': noBrandLiteral,
    'tailwind-v4': tailwindV4,
    'classname-discipline': classnameDiscipline,
    'prefer-variant-classname': preferVariantClassname,
    'no-style-prop': noStyleProp,
    'effect-needs-reason': effectNeedsReason,
    'no-set-state-in-effect': noSetStateInEffect,
    'inject-system-dependencies': injectSystemDependencies,
    'no-pattern-suffix': noPatternSuffix,
    'no-inert-control': noInertControl,
    'tagged-todo': taggedTodo,
    'no-secret-in-log': noSecretInLog,
    'no-relative-import-without-extension': noRelativeImportWithoutExtension,
  },
}
