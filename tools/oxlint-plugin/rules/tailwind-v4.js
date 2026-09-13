/**
 * quill/tailwind-v4
 *
 * Class strings in JSX `className`/`class`, `tv()`, and `cx()` use Tailwind
 * 4 spellings and bare forms; no arbitrary lengths on spacing, size, or
 * text utilities; layout widths reference a `(--layout-*)` variable
 * (`docs/architecture/styling.md` section 4). This is the TypeScript half
 * of what `scripts/check-tailwind.ts` used to scan; the CSS half
 * (`@apply`, `@tailwind`, `theme()`) stays in that script because oxlint's
 * JS plugins don't see CSS files.
 *
 * Heuristic for "this string is a class list": for `className`/`class` it
 * is unconditional — the attribute name says so. For `tv()`/`cx()` calls,
 * every string literal or static-template chunk reachable through plain
 * objects, arrays, and nested calls in the arguments is checked, but only
 * once it "looks like" a class list: every whitespace-separated token is
 * class-shaped (letters, digits, and `-:./%#()'"*&>+~@=[]!`) and at least
 * one token carries a `-`, `:`, or `[`. This mirrors the check the old
 * script used and keeps the rule from flagging incidental strings (a
 * `messages` map inside `tv()`'s `meta`, say).
 *
 * Detection rules are the same table `check-tailwind.ts` used. A subset —
 * the pure renames named in the table below — also carries a `fix` that
 * rewrites the matched token in place; the rest (arbitrary lengths, the
 * opacity modifier, the layout-variable case) only report, because turning
 * them into the right utility needs to know the design intent, not just
 * the syntax.
 */

const CLASS_TOKEN = /^[!\w[\]\-:/.%#(),'"*&>+~@=]+$/

function looksLikeClassList(text) {
  const tokens = text.trim().split(/\s+/)
  return (
    tokens.length > 0 &&
    tokens.every((t) => CLASS_TOKEN.test(t)) &&
    tokens.some((t) => /[-:[]/.test(t))
  )
}

/** A whole class token, optionally behind stacked variants such as `hover:` or `data-[state=open]:`. */
const token = (name) => new RegExp(`(?:^|\\s)(?:[\\w[\\]=-]+:)*${name}(?=\\s|$)`)

const RULES = [
  {
    pattern: token('rounded'),
    message:
      'bare `rounded` no longer exists in Tailwind 4; use rounded-sm (or the size you mean).',
  },
  {
    pattern: token('shadow'),
    message: 'bare `shadow` no longer exists in Tailwind 4; use shadow-sm (or the size you mean).',
  },
  {
    pattern: token('drop-shadow'),
    message: 'bare `drop-shadow` no longer exists in Tailwind 4; use drop-shadow-sm.',
  },
  { pattern: token('blur'), message: 'bare `blur` no longer exists in Tailwind 4; use blur-sm.' },
  {
    pattern: token('backdrop-blur'),
    message: 'bare `backdrop-blur` no longer exists in Tailwind 4; use backdrop-blur-sm.',
  },
  {
    pattern: token('outline-none'),
    message:
      '`outline-none` now removes the outline entirely; use outline-hidden, and never on a focusable element.',
    fix: (text) => text.replace(/\boutline-none\b/g, 'outline-hidden'),
  },
  {
    pattern: token('(?:bg|text|border|divide|ring|placeholder)-opacity-\\d+'),
    message:
      'opacity utilities were removed in Tailwind 4; use the modifier, for example bg-black/50.',
  },
  {
    pattern: token('flex-(?:shrink|grow)(?:-\\d+)?'),
    message: 'renamed to shrink-* and grow-* in Tailwind 4.',
    fix: (text) =>
      text.replace(
        /\bflex-(shrink|grow)(-\d+)?\b/g,
        (_, kind, suffix) => `${kind === 'shrink' ? 'shrink' : 'grow'}${suffix ?? ''}`,
      ),
  },
  {
    pattern: token('overflow-ellipsis'),
    message: 'renamed to text-ellipsis in Tailwind 4.',
    fix: (text) => text.replace(/\boverflow-ellipsis\b/g, 'text-ellipsis'),
  },
  {
    pattern: token('decoration-(?:slice|clone)'),
    message: 'renamed to box-decoration-slice and box-decoration-clone in Tailwind 4.',
    fix: (text) => text.replace(/\bdecoration-(slice|clone)\b/g, 'box-decoration-$1'),
  },
  {
    pattern: token('bg-gradient-to-[a-z]+'),
    message: 'renamed to bg-linear-to-* in Tailwind 4.',
    fix: (text) => text.replace(/\bbg-gradient-to-([a-z]+)\b/g, 'bg-linear-to-$1'),
  },
  {
    pattern: token('![a-z][\\w-]*'),
    message: 'the important modifier moved to the end in Tailwind 4: flex! not !flex.',
    fix: (text) => text.replace(/(^|\s)!([a-z][\w-]*)/g, '$1$2!'),
  },
  {
    pattern: /(?:^|[\s:])(?:group-|peer-|in-|not-)?data-\[[a-z][\w-]*\]:/,
    message:
      'a boolean data attribute has a bare variant in Tailwind 4: data-active: not data-[active]:.',
    fix: (text) =>
      text.replace(/((?:group-|peer-|in-|not-)?)data-\[([a-z][\w-]*)\]:/g, '$1data-$2:'),
  },
  {
    pattern:
      /(?:^|[\s:])(?:group-|peer-|in-|not-)?aria-\[(?:busy|checked|disabled|expanded|hidden|pressed|readonly|required|selected)=true\]:/,
    message: 'boolean aria variants are bare in Tailwind 4: aria-busy: not aria-[busy=true]:.',
    fix: (text) =>
      text.replace(
        /((?:group-|peer-|in-|not-)?)aria-\[(busy|checked|disabled|expanded|hidden|pressed|readonly|required|selected)=true\]:/g,
        '$1aria-$2:',
      ),
  },
  {
    pattern: /grid-(?:cols|rows)-\[repeat\(\d+,\s*minmax\(0,\s*1fr\)\)\]/,
    message: 'Tailwind 4 accepts any count without brackets: grid-cols-15.',
    fix: (text) =>
      text.replace(/grid-(cols|rows)-\[repeat\((\d+),\s*minmax\(0,\s*1fr\)\)\]/g, 'grid-$1-$2'),
  },
  {
    pattern: /(?:min-|max-)?[hw]-\[100(?:d|s|l)?v[hw]\]/,
    message: 'viewport units have bare utilities in Tailwind 4: min-h-dvh, h-svh, w-lvw.',
    fix: (text) => text.replace(/(min-|max-)?([hw])-\[100((?:d|s|l)?v[hw])\]/g, '$1$2-$3'),
  },
  {
    pattern: /\[&>\*\]:/,
    message: 'direct-children selector has a bare variant in Tailwind 4: *:.',
    fix: (text) => text.replace(/\[&>\*\]:/g, '*:'),
  },
  {
    pattern: /\[&_\*\]:/,
    message: 'all-descendants selector has a bare variant in Tailwind 4: **:.',
    fix: (text) => text.replace(/\[&_\*\]:/g, '**:'),
  },
  {
    pattern:
      /(?:^|[\s:])-?(?:[hw]|size|min-[hw]|max-[hw]|p[xytrbl]?|m[xytrbl]?|gap(?:-[xy])?|space-[xy]|inset(?:-[xy])?|top|right|bottom|left|indent|scroll-[pm][xytrbl]?|basis|translate(?:-[xy])?)-\[\d+(?:\.\d+)?(?:px|rem)\]/,
    message:
      'spacing and size utilities take any number in Tailwind 4 (w-17 is 17 x --spacing); use the scale or a (--layout-*) variable, not an arbitrary length.',
  },
  {
    pattern: /(?:^|[\s:])text-\[\d+(?:\.\d+)?(?:px|rem)\]/,
    message:
      'font sizes come from the type scale tokens (text-sm, text-reading); no arbitrary sizes.',
  },
]

/** Collects candidate class-list strings reachable through tv()/cx() arguments. */
function collectClassLiterals(node, out) {
  if (!node) return
  if (node.type === 'Literal' && typeof node.value === 'string') {
    out.push({ node, text: node.value })
    return
  }
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    out.push({
      node: node.quasis[0],
      text: node.quasis[0].value.cooked ?? node.quasis[0].value.raw,
    })
    return
  }
  if (node.type === 'ObjectExpression') {
    for (const prop of node.properties)
      if (prop.type === 'Property') collectClassLiterals(prop.value, out)
    return
  }
  if (node.type === 'ArrayExpression') {
    for (const element of node.elements) collectClassLiterals(element, out)
    return
  }
  if (node.type === 'CallExpression') {
    for (const arg of node.arguments) collectClassLiterals(arg, out)
  }
}

function report(context, node, text) {
  // Only a plain string Literal has a quote character to rebuild around; a
  // static template literal's quasi is reported but never auto-fixed.
  const canFix = node.type === 'Literal' && typeof node.raw === 'string'
  for (const rule of RULES) {
    if (!rule.pattern.test(text)) continue
    const fixedText = rule.fix?.(text)
    const hasFix = canFix && fixedText !== undefined && fixedText !== text
    context.report({
      node,
      message: rule.message,
      fix: hasFix
        ? (fixer) => {
            const quote = node.raw[0]
            return fixer.replaceText(node, `${quote}${fixedText}${quote}`)
          }
        : undefined,
    })
  }
}

const rule = {
  meta: {
    type: 'problem',
    fixable: 'code',
    docs: { description: 'require Tailwind 4 class spellings' },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (
          node.name.type !== 'JSXIdentifier' ||
          (node.name.name !== 'className' && node.name.name !== 'class')
        ) {
          return
        }
        const value = node.value
        if (value?.type === 'Literal' && typeof value.value === 'string') {
          report(context, value, value.value)
        } else if (
          value?.type === 'JSXExpressionContainer' &&
          value.expression.type === 'Literal'
        ) {
          const literal = value.expression
          if (typeof literal.value === 'string') report(context, literal, literal.value)
        }
      },
      CallExpression(node) {
        if (
          node.callee.type !== 'Identifier' ||
          (node.callee.name !== 'tv' && node.callee.name !== 'cx')
        )
          return
        const literals = []
        for (const arg of node.arguments) collectClassLiterals(arg, literals)
        for (const { node: literalNode, text } of literals) {
          if (looksLikeClassList(text)) report(context, literalNode, text)
        }
      },
    }
  },
}

export default rule
