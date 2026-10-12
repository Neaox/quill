import { toString } from 'mdast-util-to-string'
import type { TextDirective } from 'mdast-util-directive'

import { nearestName } from './nearest-name.ts'
import { KNOWN_DIRECTIVES } from './registry.ts'

/**
 * The shape of a tenant label's name (ADR-037): the theme's
 * `LABEL_NAME_PATTERN`, held to it by a test in the server, which is the one
 * package that depends on both. The sanitiser admits `data-label` only with
 * this shape.
 */
export const LABEL_NAME = /^[a-z][a-z0-9-]{0,31}$/u

/**
 * Whether a text directive's name is one of the organisation's labels:
 * `acme` when the theme defines it. A built-in text directive of the same
 * name wins — a stored label a newer release shadows is the theme doctor's
 * to report — and a name the theme does not define is an unknown directive,
 * written back as typed (ADR-002), which is how a typo stays visible. The
 * reader's renderer and the editor both ask this, so a label looks the same
 * while it is written as when it is read.
 */
export function isLabelDirective(name: string, labels: ReadonlySet<string>): boolean {
  return labels.has(name) && LABEL_NAME.test(name) && !isBuiltInText(name)
}

function isBuiltInText(name: string): boolean {
  return KNOWN_DIRECTIVES.some(
    (definition) => definition.names.includes(name) && definition.kinds.includes('text'),
  )
}

/**
 * Whether a text directive is drawn as a label: `:acme[Acme]`, with
 * words, because a label's text is its meaning.
 */
export function isLabel(node: TextDirective, labels: ReadonlySet<string>): boolean {
  return isLabelDirective(node.name, labels) && toString(node).trim().length > 0
}

/**
 * What to tell an author about a labelled text directive that is neither
 * built in nor one of the organisation's labels — `:acm[Acme]` — or
 * undefined when there is nothing to say. It still renders as written
 * (ADR-002); the warning is how a typo is noticed before a reader sees it
 * (ADR-037), with the nearest label offered when one is near enough.
 */
export function unknownLabelWarning(
  name: string,
  text: string,
  labels: ReadonlySet<string>,
): string | undefined {
  if (text.trim().length === 0 || !LABEL_NAME.test(name)) return undefined
  if (labels.has(name) || isBuiltInText(name)) return undefined
  const nearest = nearestName(name, labels)
  const unknown = `Unknown label “${name}”; it will show as written.`
  return nearest === undefined ? unknown : `${unknown} Did you mean ${nearest}?`
}
