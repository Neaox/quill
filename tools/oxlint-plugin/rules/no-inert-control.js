/**
 * quill/no-inert-control
 *
 * Nothing interactive is inert (`docs/design/feedback.md`): a control a
 * pointer or keyboard can activate must do something when it is activated —
 * carry an action, or be visibly disabled with a reason. A button that looks
 * pressable and silently does nothing is a broken affordance, not a neutral
 * one.
 *
 * Scope: enabled only in `apps/web/**` by an `.oxlintrc.json` override.
 * `packages/ui` is exempt on purpose — a primitive's own tests and specimens
 * render `Button` bare, with no action to give it, because showing the
 * primitive itself is the point of that render.
 *
 * Heuristic: a `<Button>` or `<button>` is inert when its opening tag carries
 * none of `onClick`, `type="submit"`, `disabled`, `loading`, `asChild`, or a
 * spread attribute (`{...props}`). The spread can't be judged statically —
 * the action this rule is looking for might be inside it — so it is trusted
 * outright, the same trade-off `quill/classname-discipline` makes for an
 * arbitrary function call: a miss here is cheaper than a false positive on
 * every component that forwards its props through. `disabled`/`loading` are
 * checked by presence, not value, for the same reason `type="submit"` is
 * checked by value and nothing else is: a dynamic `disabled={isLocked}`
 * can't be evaluated here, and treating its mere presence as "this button
 * was deliberately wired to a real state" is the reading that avoids
 * flagging code that already does the right thing. An `<a>` is inert without
 * `href`; a `<Link>` is inert without `to`.
 *
 * Two more shapes are trusted rather than flagged, for the same reason as
 * the spread: Radix's `asChild` clones the interactive behaviour onto its
 * child from outside the JSX this rule can see, so the element written at
 * the call site never carries its own `onClick`:
 *   - the value of a `trigger` prop (`<Dialog trigger={<Button>…}>` in
 *     `packages/ui`'s `Dialog`) — the primitive wraps it in its own
 *     `asChild` trigger, which is what opens it;
 *   - a child of `<DialogClose>` — the same mechanism, for closing it.
 * Flagging either would mean every dialog trigger and every dialog's cancel
 * button in the codebase needs a redundant `onClick` next to the one Radix
 * already wires up for it.
 *
 * No auto-fix: giving a control an action, or a disabled reason, is a
 * product decision this rule cannot make for the author.
 */

const MESSAGE =
  'Interactive elements never silently do nothing: give it an action, or disable it with a reason (docs/design/feedback.md)'

function jsxName(nameNode) {
  return nameNode.type === 'JSXIdentifier' ? nameNode.name : null
}

function attributeName(attribute) {
  if (attribute.type !== 'JSXAttribute') return null
  return jsxName(attribute.name)
}

function isLiteralString(attribute, value) {
  if (attribute.value === null) return false
  if (attribute.value.type === 'Literal') return attribute.value.value === value
  if (attribute.value.type === 'JSXExpressionContainer') {
    const expression = attribute.value.expression
    return expression.type === 'Literal' && expression.value === value
  }
  return false
}

const ACTION_PROPS = new Set(['onClick', 'disabled', 'loading', 'asChild'])

/** True when a `<Button>`/`<button>` opening tag carries a recognised action or escape hatch. */
function buttonHasAction(openingElement) {
  for (const attribute of openingElement.attributes) {
    if (attribute.type === 'JSXSpreadAttribute') return true
    const name = attributeName(attribute)
    if (name === null) continue
    if (ACTION_PROPS.has(name)) return true
    if (name === 'type' && isLiteralString(attribute, 'submit')) return true
  }
  return false
}

/** True when an `<a>`/`<Link>` opening tag carries `propName` or a spread. */
function hasNavigationTarget(openingElement, propName) {
  for (const attribute of openingElement.attributes) {
    if (attribute.type === 'JSXSpreadAttribute') return true
    if (attributeName(attribute) === propName) return true
  }
  return false
}

/** True when `element` is wired up by an ancestor's own `asChild` mechanism (see doc comment). */
function trustedByAncestor(element) {
  const parent = element.parent
  if (parent === null || parent === undefined) return false

  if (parent.type === 'JSXElement' && jsxName(parent.openingElement.name) === 'DialogClose') {
    return true
  }

  if (
    parent.type === 'JSXExpressionContainer' &&
    parent.parent?.type === 'JSXAttribute' &&
    attributeName(parent.parent) === 'trigger'
  ) {
    return true
  }

  return false
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'disallow interactive elements with no action, escape hatch, or disabled reason',
    },
  },
  create(context) {
    return {
      JSXElement(node) {
        const opening = node.openingElement
        const tagName = jsxName(opening.name)
        if (tagName === null) return

        if (tagName === 'Button' || tagName === 'button') {
          if (buttonHasAction(opening)) return
          if (trustedByAncestor(node)) return
          context.report({ node: opening, message: MESSAGE })
          return
        }

        if (tagName === 'a') {
          if (hasNavigationTarget(opening, 'href')) return
          context.report({ node: opening, message: MESSAGE })
          return
        }

        if (tagName === 'Link') {
          if (hasNavigationTarget(opening, 'to')) return
          context.report({ node: opening, message: MESSAGE })
        }
      },
    }
  },
}

export default rule
