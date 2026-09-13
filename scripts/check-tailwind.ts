/**
 * Fails when CSS files use Tailwind 3 spellings that Tailwind 4 removed, or
 * whose meaning changed in a way that breaks accessibility or layout
 * silently. Names that survived the upgrade with a shifted value
 * (`rounded-sm`, `shadow-sm`) are canonical in 4 and are not flagged; this
 * repository defines its own radius and shadow scales in `@theme`, so those
 * names mean exactly what they say here.
 *
 * Only `@apply` lines and Tailwind directives are scanned, so prose in CSS
 * comments never trips it.
 *
 * The equivalent check for class strings in TypeScript — `className`,
 * `tv()`, and `cx()` — is `quill/tailwind-v4` (`tools/oxlint-plugin`); that
 * half moved to a lint rule because it runs in the editor and can auto-fix
 * the pure renames. This script keeps the CSS half because oxlint's JS
 * plugins don't see CSS files at all.
 *
 * Usage: node scripts/check-tailwind.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOTS = ['apps', 'packages']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', 'generated', 'spikes'])

interface Rule {
  readonly pattern: RegExp
  readonly message: string
}

/** A whole class token, optionally behind stacked variants such as `hover:` or `data-[state=open]:`. */
const token = (name: string): RegExp => new RegExp(`(?:^|\\s)(?:[\\w\\[\\]=-]+:)*${name}(?=\\s|$)`)

const CLASS_RULES: readonly Rule[] = [
  {
    pattern: token('rounded'),
    message: 'bare `rounded` no longer exists in Tailwind 4; use rounded-sm (or the size you mean)',
  },
  {
    pattern: token('shadow'),
    message: 'bare `shadow` no longer exists in Tailwind 4; use shadow-sm (or the size you mean)',
  },
  {
    pattern: token('drop-shadow'),
    message: 'bare `drop-shadow` no longer exists in Tailwind 4; use drop-shadow-sm',
  },
  { pattern: token('blur'), message: 'bare `blur` no longer exists in Tailwind 4; use blur-sm' },
  {
    pattern: token('backdrop-blur'),
    message: 'bare `backdrop-blur` no longer exists in Tailwind 4; use backdrop-blur-sm',
  },
  {
    pattern: token('outline-none'),
    message:
      '`outline-none` now removes the outline entirely; use outline-hidden, and never on a focusable element',
  },
  {
    pattern: token('(?:bg|text|border|divide|ring|placeholder)-opacity-\\d+'),
    message:
      'opacity utilities were removed in Tailwind 4; use the modifier, for example bg-black/50',
  },
  {
    pattern: token('flex-(?:shrink|grow)(?:-\\d+)?'),
    message: 'renamed to shrink-* and grow-* in Tailwind 4',
  },
  { pattern: token('overflow-ellipsis'), message: 'renamed to text-ellipsis in Tailwind 4' },
  {
    pattern: token('decoration-(?:slice|clone)'),
    message: 'renamed to box-decoration-slice and box-decoration-clone in Tailwind 4',
  },
  { pattern: token('bg-gradient-to-[a-z]+'), message: 'renamed to bg-linear-to-* in Tailwind 4' },
  {
    pattern: token('![a-z][\\w-]*'),
    message: 'the important modifier moved to the end in Tailwind 4: flex! not !flex',
  },
  // Bracketed forms that Tailwind 4 spells bare.
  {
    pattern: /(?:^|[\s:])(?:group-|peer-|in-|not-)?data-\[[a-z][\w-]*\]:/,
    message:
      'a boolean data attribute has a bare variant in Tailwind 4: data-active: not data-[active]:',
  },
  {
    pattern:
      /(?:^|[\s:])(?:group-|peer-|in-|not-)?aria-\[(?:busy|checked|disabled|expanded|hidden|pressed|readonly|required|selected)=true\]:/,
    message: 'boolean aria variants are bare in Tailwind 4: aria-busy: not aria-[busy=true]:',
  },
  {
    pattern: /grid-(?:cols|rows)-\[repeat\(\d+,\s*minmax\(0,\s*1fr\)\)\]/,
    message: 'Tailwind 4 accepts any count without brackets: grid-cols-15',
  },
  {
    pattern: /(?:min-|max-)?[hw]-\[100(?:d|s|l)?v[hw]\]/,
    message: 'viewport units have bare utilities in Tailwind 4: min-h-dvh, h-svh, w-lvw',
  },
  {
    pattern: /\[&>\*\]:/,
    message: 'direct-children selector has a bare variant in Tailwind 4: *:',
  },
  {
    pattern: /\[&_\*\]:/,
    message: 'all-descendants selector has a bare variant in Tailwind 4: **:',
  },
  // Sizes derive from `--spacing` in Tailwind 4, so any multiple of the base has a bare utility.
  {
    pattern:
      /(?:^|[\s:])-?(?:[hw]|size|min-[hw]|max-[hw]|p[xytrbl]?|m[xytrbl]?|gap(?:-[xy])?|space-[xy]|inset(?:-[xy])?|top|right|bottom|left|indent|scroll-[pm][xytrbl]?|basis|translate(?:-[xy])?)-\[\d+(?:\.\d+)?(?:px|rem)\]/,
    message:
      'spacing and size utilities take any number in Tailwind 4 (w-17 is 17 × --spacing); use the scale, not an arbitrary length',
  },
  {
    pattern: /(?:^|[\s:])text-\[\d+(?:\.\d+)?(?:px|rem)\]/,
    message:
      'font sizes come from the type scale tokens (text-sm, text-reading); no arbitrary sizes',
  },
]

const CSS_RULES: readonly Rule[] = [
  {
    pattern: /@tailwind\s+(base|components|utilities)/,
    message: "Tailwind 4 uses @import 'tailwindcss' instead of @tailwind directives",
  },
  {
    pattern: /\btheme\(\s*['"]?[a-zA-Z]/,
    message:
      'the theme() function is superseded by CSS variables such as var(--color-accent) in Tailwind 4',
  },
  {
    pattern: /@layer\s+utilities\s*\{/,
    message: 'custom utilities are declared with @utility in Tailwind 4, not @layer utilities',
  },
]

interface Hit {
  readonly file: string
  readonly line: number
  readonly text: string
  readonly message: string
}

function scanCss(file: string, source: string): Hit[] {
  const hits: Hit[] = []
  source.split('\n').forEach((text, index) => {
    const line = index + 1
    for (const rule of CSS_RULES) {
      if (rule.pattern.test(text))
        hits.push({ file, line, text: text.trim(), message: rule.message })
    }
    const apply = /@apply\s+([^;]+);/.exec(text)
    if (apply?.[1] !== undefined) {
      for (const rule of CLASS_RULES) {
        if (rule.pattern.test(apply[1]))
          hits.push({ file, line, text: text.trim(), message: rule.message })
      }
    }
  })
  return hits
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* walk(path)
    else if (entry.endsWith('.css')) yield path
  }
}

const hits = ROOTS.flatMap((root) =>
  [...walk(root)].flatMap((path) => {
    const source = readFileSync(path, 'utf8')
    const file = relative(process.cwd(), path)
    return scanCss(file, source)
  }),
)

if (hits.length > 0) {
  console.error(`check:tailwind found ${hits.length} Tailwind 3 spelling(s):\n`)
  for (const hit of hits) console.error(`${hit.file}:${hit.line}: ${hit.message}\n    ${hit.text}`)
  process.exit(1)
}
console.log('check:tailwind: every CSS file uses Tailwind 4 spelling.')
