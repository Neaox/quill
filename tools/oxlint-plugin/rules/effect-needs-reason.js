/**
 * quill/effect-needs-reason
 *
 * Every `useEffect` and `useLayoutEffect` is immediately preceded by a
 * comment naming the external system it synchronises with (ADR-013,
 * AGENTS.md rule 6) — `useEffect` exists to talk to something outside
 * React, and a reader should not have to infer what from the callback body.
 *
 * Heuristic: matches a call to a bare `useEffect`/`useLayoutEffect`
 * identifier, or a member call such as `React.useEffect`, and requires the
 * comment immediately before it (`sourceCode.getCommentsBefore`) to end on
 * the line directly above the call. This can't verify the comment actually
 * *names* the external system — that's left to review — only that a
 * comment is there, right above the call, and not separated by a blank
 * line or unrelated code.
 *
 * No auto-fix: the rule has no way to know what the effect synchronises
 * with.
 */

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

const rule = {
  meta: {
    type: 'suggestion',
    docs: { description: 'require a reason comment immediately above every effect' },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isEffectCall(node)) return
        const comments = context.sourceCode.getCommentsBefore(node)
        const last = comments.at(-1)
        const hasAdjacentComment =
          last !== undefined && last.loc.end.line === node.loc.start.line - 1
        if (hasAdjacentComment) return
        const name =
          node.callee.type === 'Identifier' ? node.callee.name : node.callee.property.name
        context.report({
          node,
          message: `Add a comment above this ${name} naming the external system it synchronises with.`,
        })
      },
    }
  },
}

export default rule
