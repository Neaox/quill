import type { PhrasingContent } from 'mdast'

/** The inline content of a paragraph up to its first line break, and what follows it. */
export function splitFirstLine(
  children: readonly PhrasingContent[],
): { readonly line: PhrasingContent[]; readonly rest: PhrasingContent[] } | undefined {
  const line: PhrasingContent[] = []
  for (const [index, child] of children.entries()) {
    if (child.type === 'break') return undefined
    if (child.type === 'text' && child.value.includes('\n')) {
      const cut = child.value.indexOf('\n')
      const before = child.value.slice(0, cut)
      const after = child.value.slice(cut + 1)
      return {
        line: [...line, ...(before === '' ? [] : [{ ...child, value: before }])],
        rest: [...(after === '' ? [] : [{ ...child, value: after }]), ...children.slice(index + 1)],
      }
    }
    line.push(child)
  }
  return { line, rest: [] }
}
