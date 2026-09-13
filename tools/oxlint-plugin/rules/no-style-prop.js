/**
 * quill/no-style-prop
 *
 * The JSX `style` attribute is allowed only when every key is a CSS custom
 * property (`--x`) — the one channel a genuinely dynamic value (a computed
 * position, a drag offset) has to reach CSS (`docs/architecture/styling.md`).
 *
 * Heuristic: only checks `style={{ ... }}` — an object literal passed
 * directly as the expression. A property is flagged when its key is a
 * plain identifier (`color`, `top`) or a string literal that doesn't start
 * with `--`. Computed keys (`style={{ [x]: y }}`) and spreads
 * (`style={{ ...base }}`) can't be verified statically and are left alone,
 * as is any `style` value that isn't an inline object literal (a variable,
 * a function call) — flagging those would mean guessing at content this
 * rule cannot see, and a miss here is far cheaper than blocking a
 * legitimate dynamic style with a false positive.
 *
 * No auto-fix: replacing a style property means picking a Tailwind utility
 * or design token, which is a judgement call.
 */

function keyName(key) {
  if (key.type === 'Identifier') return key.name
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value
  return null
}

const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'restrict the JSX style prop to CSS custom properties' },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'style') return
        if (node.value?.type !== 'JSXExpressionContainer') return
        const expression = node.value.expression
        if (expression.type !== 'ObjectExpression') return

        for (const prop of expression.properties) {
          if (prop.type !== 'Property' || prop.computed) continue
          const name = keyName(prop.key)
          if (name === null || name.startsWith('--')) continue
          context.report({
            node: prop,
            message: `Use a Tailwind utility or design token for \`${name}\`; the style attribute may only set CSS custom properties (--x).`,
          })
        }
      },
    }
  },
}

export default rule
