import type { Element, ElementContent, Properties } from 'hast'

/** An element, for a renderer that builds hast by hand: the tag, its properties and its children. */
export function element(
  tagName: string,
  properties: Properties,
  children: ElementContent[],
): Element {
  return { type: 'element', tagName, properties, children }
}

/** A run of text. */
export function text(value: string): ElementContent {
  return { type: 'text', value }
}
