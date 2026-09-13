/**
 * quill/no-set-state-in-effect
 *
 * No synchronous `setX(...)` call in the body of an effect — that turns
 * state into a command bus, which ADR-013 rejects in favour of an event
 * handler or a derived value. A call made from inside a subscription
 * callback, a promise handler, a timer, or the effect's own cleanup
 * function is fine, because that call happens later, in reaction to
 * something, not synchronously during the effect's own run.
 *
 * Heuristic: walks the statements inside a `useEffect`/`useLayoutEffect`
 * callback, following ordinary control flow (blocks, `if`, loops, `try`,
 * `switch`), but stops at the boundary of any nested function — an arrow
 * function, function expression, or the returned cleanup function — since
 * code inside one of those runs later, not as part of the effect's
 * synchronous body. Within that reachable set, a `CallExpression` whose
 * callee is a bare identifier matching `/^set[A-Z]/` (the conventional
 * shape of a `useState` setter) is flagged, except the global timer
 * functions `setTimeout`, `setInterval`, and `setImmediate`, which match
 * the same shape but are not state setters — starting a timer synchronously
 * in an effect is the normal way to use one. Beyond that named exclusion,
 * this will still catch a same-named helper that merely starts with `set`
 * and an uppercase letter; that narrower false-positive risk is accepted
 * deliberately, since a stray `setSomething()` at the top of an effect is
 * exactly the shape this rule exists to question.
 *
 * No auto-fix: moving the call to an event handler or deriving the value
 * instead is a design decision, not a mechanical rewrite.
 */

const SETTER_NAME = /^set[A-Z]/
const NOT_A_SETTER = new Set(['setTimeout', 'setInterval', 'setImmediate'])

function isEffectCall(node) {
  const callee = node.callee
  if (callee.type === 'Identifier') {
    return callee.name === 'useEffect' || callee.name === 'useLayoutEffect'
  }
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier'
  ) {
    return callee.property.name === 'useEffect' || callee.property.name === 'useLayoutEffect'
  }
  return false
}

const FUNCTION_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionExpression',
  'FunctionDeclaration',
])

/** Visits every descendant reachable without crossing into a nested function body. */
function walkSynchronousBody(node, visit) {
  if (!node || typeof node.type !== 'string') return
  visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue
    const value = node[key]
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child.type === 'string' && !FUNCTION_TYPES.has(child.type)) {
          walkSynchronousBody(child, visit)
        }
      }
    } else if (value && typeof value.type === 'string' && !FUNCTION_TYPES.has(value.type)) {
      walkSynchronousBody(value, visit)
    }
  }
}

const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'disallow synchronous state setter calls in an effect body' },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isEffectCall(node)) return
        const callback = node.arguments[0]
        if (!callback || !FUNCTION_TYPES.has(callback.type)) return

        walkSynchronousBody(callback.body, (descendant) => {
          if (
            descendant.type === 'CallExpression' &&
            descendant.callee.type === 'Identifier' &&
            SETTER_NAME.test(descendant.callee.name) &&
            !NOT_A_SETTER.has(descendant.callee.name)
          ) {
            context.report({
              node: descendant,
              message: `Call ${descendant.callee.name}(...) from an event handler or a subscription callback, not synchronously in the effect body.`,
            })
          }
        })
      },
    }
  },
}

export default rule
