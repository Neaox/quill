/**
 * quill/prefer-variant-classname
 *
 * A `tv()`-produced variant or slot function (`buttonStyles({ variant })`,
 * `styles.root()`, `tabsStyles().root()`) already merges the `className` it
 * is given through `tailwind-merge` (`packages/ui/src/lib/class-names.ts`),
 * so wrapping its result in `cx(...)` just to splice a passed-through prop
 * back in is redundant: tailwind-variants accepts `className` directly, so
 * `cx` is redundant there (`docs/architecture/styling.md` section 2).
 *
 * Heuristic: fires on `cx(...)` called with **exactly two arguments** where
 * the first is a `CallExpression` that is not itself `cx(...)` — a variant
 * or slot call — and the second is an `Identifier`, a `MemberExpression`
 * (`className`, `props.className`, `bodyClassName`), or a string literal.
 * Two string literals, a literal first argument, three or more arguments,
 * and `cx(a, b)` where `a` isn't a call are left alone — merging two
 * strings, or two variant results, is exactly what `cx` is for
 * (`quill/classname-discipline` already allows that shape).
 *
 * Auto-fix folds the second argument into the variant call and drops the
 * `cx(...)` wrapper:
 *   - the variant call has no arguments → `callee({ className })`, or
 *     `callee({ className: <expr> })` when the passed value isn't literally
 *     an identifier named `className`;
 *   - the variant call's single argument is an object literal with no
 *     `className`/`class` property → the same shorthand rule, appended as
 *     a property inside that object.
 *
 * Anything else — a non-object single argument (`styles.root(props)`, whose
 * shape at runtime this rule cannot see), an object that already sets
 * `className`/`class`, or an object built with a spread — is reported
 * without a fix: rewriting would mean guessing whether the existing value
 * should win, lose, or merge with the passed-through one, which is a
 * judgement call, not a mechanical rewrite.
 */

function isCxCall(node) {
  return (
    node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'cx'
  )
}

function isPassthroughSecondArgument(node) {
  if (node.type === 'Identifier' || node.type === 'MemberExpression') return true
  return node.type === 'Literal' && typeof node.value === 'string'
}

/** Mirrors `no-style-prop.js`'s key check: null for anything that can't be read statically. */
function keyName(key) {
  if (key.type === 'Identifier') return key.name
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value
  return null
}

function objectHasClassNameProperty(objectExpression) {
  return objectExpression.properties.some((prop) => {
    if (prop.type !== 'Property' || prop.computed) return false
    const name = keyName(prop.key)
    return name === 'className' || name === 'class'
  })
}

function objectHasSpread(objectExpression) {
  return objectExpression.properties.some((prop) => prop.type === 'SpreadElement')
}

/** The text to splice in: bare `className` shorthand, or `className: <expr>`. */
function insertionText(sourceCode, secondArgument) {
  if (secondArgument.type === 'Identifier' && secondArgument.name === 'className') {
    return 'className'
  }
  return `className: ${sourceCode.getText(secondArgument)}`
}

function buildFix(sourceCode, cxCall, variantCall, secondArgument) {
  const calleeText = sourceCode.getText(variantCall.callee)
  const insertion = insertionText(sourceCode, secondArgument)

  if (variantCall.arguments.length === 0) {
    return (fixer) => fixer.replaceText(cxCall, `${calleeText}({ ${insertion} })`)
  }

  const soleArgument = variantCall.arguments[0]
  if (
    variantCall.arguments.length !== 1 ||
    soleArgument.type !== 'ObjectExpression' ||
    objectHasSpread(soleArgument) ||
    objectHasClassNameProperty(soleArgument)
  ) {
    return undefined
  }

  // Strip trailing whitespace before the closing brace so the appended
  // property sits next to a single space and, when there's company, a
  // comma — not wherever the original formatting happened to leave a gap.
  const objectText = sourceCode.getText(soleArgument)
  const newObjectText =
    soleArgument.properties.length === 0
      ? objectText.replace(/\s*\}$/, ` ${insertion} }`)
      : objectText.replace(/\s*\}$/, `, ${insertion} }`)
  return (fixer) => fixer.replaceText(cxCall, `${calleeText}(${newObjectText})`)
}

const rule = {
  meta: {
    type: 'problem',
    fixable: 'code',
    docs: {
      description: 'prefer passing className to a tailwind-variants call over wrapping it in cx()',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isCxCall(node) || node.arguments.length !== 2) return
        const [first, second] = node.arguments
        if (first.type !== 'CallExpression' || isCxCall(first)) return
        if (!isPassthroughSecondArgument(second)) return

        context.report({
          node,
          message:
            'tailwind-variants accepts `className` directly, so `cx` is redundant there; call the variant with `{ className }` instead.',
          fix: buildFix(context.sourceCode, node, first, second),
        })
      },
    }
  },
}

export default rule
