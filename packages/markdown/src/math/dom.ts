/// <reference lib="dom" />

import type { MathElement } from './tree.ts'

/** The namespace the browser draws math in. */
const MATHML = 'http://www.w3.org/1998/Math/MathML'

/**
 * A formula's tree as DOM nodes, for the editor's own view of it (ADR-064). The reading surfaces
 * get the same tree as hast (`render.ts`); both are the tree `tree.ts` has already kept to
 * what `grant.ts` allows, so neither checks it again.
 */
export function mathDom(node: MathElement | string, doc: Document): Node {
  if (typeof node === 'string') return doc.createTextNode(node)
  const element = doc.createElementNS(MATHML, node.tag)
  for (const [name, value] of Object.entries(node.attributes)) element.setAttribute(name, value)
  element.append(...node.children.map((child) => mathDom(child, doc)))
  return element
}
