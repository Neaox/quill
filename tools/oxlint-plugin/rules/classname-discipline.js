/**
 * quill/classname-discipline
 *
 * A `className` (or `class`) attribute is a string literal, a `tv()`
 * result, or `cx(...)` of string literals — never a ternary, a logical
 * expression, or template interpolation that selects classes from state
 * (`docs/architecture/styling.md` sections 1 and 2: state belongs in an
 * attribute styled with a Tailwind variant, not in a JavaScript branch).
 *
 * Heuristic: a plain string literal, or a static template literal with no
 * interpolation, always passes. Everything else is judged by the same
 * "does this expression select a class from state" test, applied both to
 * `className={expr}` directly and to each argument of a `cx(...)` call
 * found there — `cx` is this codebase's merge utility, and its normal job
 * is combining a `tv()` result with a passed-through `className` prop
 * (`cx(buttonStyles(), className)`), so an `Identifier`, a
 * `MemberExpression`, or a `CallExpression` is allowed in both positions:
 *   - a `CallExpression` is assumed to be a `tv()`-produced variant
 *     function (`button({ variant })`) or, when its callee is `cx`, is
 *     recursed into so a ternary hidden inside a nested `cx(...)` is still
 *     caught. Any other call is trusted outright — this can't be
 *     distinguished from an arbitrary function call by syntax alone, and
 *     flagging every call would false-positive on legitimate `tv()` usage,
 *     which is worse than missing a rare misuse through a function call.
 *   - an `Identifier` or `MemberExpression` (a variable or import holding a
 *     precomputed class string or a passed-through prop) is allowed for
 *     the same reason: static analysis cannot see whether the value behind
 *     it was built from state with a ternary, and guessing would make this
 *     rule too noisy to keep on.
 *
 * What is always a violation, wherever it appears: a `ConditionalExpression`
 * (ternary), a `LogicalExpression` (`&&`, `||`, `??`), a `TemplateLiteral`
 * with interpolation, a string-concatenating `BinaryExpression`, or an
 * object literal mapping class names to booleans (the "classnames" idiom)
 * — these are exactly the "select classes from state" shapes the rule
 * exists to catch.
 *
 * No auto-fix: turning a conditional into an attribute-plus-variant is a
 * design change.
 */

function isClassAttribute(node) {
  return (
    node.name.type === 'JSXIdentifier' &&
    (node.name.name === 'className' || node.name.name === 'class')
  )
}

function isStaticTemplate(node) {
  return node.type === 'TemplateLiteral' && node.expressions.length === 0
}

function isTrustedReference(node) {
  return node.type === 'Identifier' || node.type === 'MemberExpression'
}

function isCxCall(node) {
  return (
    node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'cx'
  )
}

/** True when `node` is a shape that picks a class (or not) based on runtime state. */
function selectsFromState(node) {
  if (node.type === 'Literal' || isStaticTemplate(node) || isTrustedReference(node)) return false
  if (node.type === 'CallExpression') {
    if (!isCxCall(node)) return false
    return node.arguments.some(selectsFromState)
  }
  return true
}

const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'restrict className/class to static or variant-driven expressions' },
  },
  create(context) {
    function reportCxArguments(callExpression) {
      for (const arg of callExpression.arguments) {
        if (arg.type === 'CallExpression' && isCxCall(arg)) {
          reportCxArguments(arg)
        } else if (selectsFromState(arg)) {
          context.report({
            node: arg,
            message:
              'Pass only string literals, tv() calls, or a passed-through className to cx(...); select classes from state with an attribute and a Tailwind variant instead.',
          })
        }
      }
    }

    return {
      JSXAttribute(node) {
        if (!isClassAttribute(node)) return
        if (node.value === null || node.value.type === 'Literal') return
        if (node.value.type !== 'JSXExpressionContainer') return

        const expression = node.value.expression
        if (isCxCall(expression)) {
          reportCxArguments(expression)
          return
        }
        if (!selectsFromState(expression)) return

        context.report({
          node: expression,
          message:
            'Use a real attribute plus a Tailwind variant, or a tv() variant, instead of selecting classes from state in className.',
        })
      },
    }
  },
}

export default rule
