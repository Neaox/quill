/**
 * quill/no-secret-in-log
 *
 * A call on a logger must never carry a password, secret, token, cookie, or
 * authorization value (ADR-011: "audit without secrets").
 *
 * Heuristic for "a call on a logger": a `CallExpression` whose callee is a
 * member expression `<object>.<method>` where `<method>` is a common
 * logging level (`log`, `info`, `warn`, `error`, `debug`, `trace`, `fatal`)
 * and `<object>`'s source text contains the whole word `log` or `logger`
 * (matches `logger.info(...)`, `this.logger.warn(...)`, `appLog.error(...)`,
 * and plain `console.log(...)`, which is why this rule still matters in
 * `scripts/**` even though `no-console` is relaxed there). Anything whose
 * object text doesn't look like a logger is left alone, to keep this
 * conservative rather than flagging arbitrary method calls named `info`.
 *
 * Heuristic for "looks like a secret": an identifier, object property key,
 * or template-literal interpolated expression whose name contains
 * `password`, `secret`, `token`, `cookie`, or `authorization`
 * (case-insensitive, substring match — `refreshToken` and `Cookie` both
 * count).
 *
 * No auto-fix: removing the argument could change the call's meaning or
 * hide a value the developer needs restated some other way.
 */

const LOGGER_OBJECT = /\blog(ger)?\b/i
const LOG_METHODS = new Set(['log', 'info', 'warn', 'error', 'debug', 'trace', 'fatal'])
const SECRET_NAME = /password|secret|token|cookie|authorization/i

function isLoggerCall(node) {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.computed &&
    node.callee.property.type === 'Identifier' &&
    LOG_METHODS.has(node.callee.property.name)
  )
}

function propertyName(node) {
  if (node.type === 'Identifier') return node.name
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  return null
}

const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'disallow secret-shaped values passed to a logger call' },
  },
  create(context) {
    function checkExpression(node) {
      if (node.type === 'Identifier' && SECRET_NAME.test(node.name)) {
        context.report({
          node,
          message: `Remove \`${node.name}\` from the log call; it looks like a secret.`,
        })
        return
      }
      if (node.type === 'MemberExpression' && !node.computed) {
        const name = propertyName(node.property)
        if (name && SECRET_NAME.test(name)) {
          context.report({
            node,
            message: `Remove \`${name}\` from the log call; it looks like a secret.`,
          })
          return
        }
      }
      if (node.type === 'ObjectExpression') {
        for (const prop of node.properties) {
          if (prop.type !== 'Property' || prop.computed) continue
          const name = propertyName(prop.key)
          if (name && SECRET_NAME.test(name)) {
            context.report({
              node: prop,
              message: `Remove \`${name}\` from the log call; it looks like a secret.`,
            })
          }
        }
      }
      if (node.type === 'TemplateLiteral') {
        for (const expr of node.expressions) checkExpression(expr)
      }
    }

    return {
      CallExpression(node) {
        if (!isLoggerCall(node)) return
        const objectText = context.sourceCode.getText(node.callee.object)
        if (!LOGGER_OBJECT.test(objectText)) return
        for (const arg of node.arguments) checkExpression(arg)
      },
    }
  },
}

export default rule
