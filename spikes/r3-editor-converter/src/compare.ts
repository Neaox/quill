// Comparing two mdast trees for semantic equality.
//
// `position` is dropped (byte offsets are not semantics) and keys whose value is
// null or undefined are dropped, so an explicit `title: null` and an absent
// `title` count as the same tree.
export function normaliseMdast(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normaliseMdast)
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      if (key === 'position') continue
      const v = source[key]
      if (v === null || v === undefined) continue
      out[key] = normaliseMdast(v)
    }
    return out
  }
  return value
}

export function mdastEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(normaliseMdast(a)) === JSON.stringify(normaliseMdast(b))
}

export type Diff = { path: string; left: string; right: string }

export function firstDiffs(a: unknown, b: unknown, limit = 3): Diff[] {
  const diffs: Diff[] = []
  const walk = (x: any, y: any, path: string) => {
    if (diffs.length >= limit) return
    if (JSON.stringify(x) === JSON.stringify(y)) return
    if (Array.isArray(x) && Array.isArray(y)) {
      for (let i = 0; i < Math.max(x.length, y.length); i += 1) walk(x[i], y[i], `${path}[${i}]`)
      return
    }
    if (x && y && typeof x === 'object' && typeof y === 'object') {
      const keys = new Set([...Object.keys(x), ...Object.keys(y)])
      const label = x.type ? `${path}<${x.type}>` : path
      for (const k of keys) walk(x[k], y[k], `${label}.${k}`)
      return
    }
    diffs.push({
      path,
      left: JSON.stringify(x) ?? 'undefined',
      right: JSON.stringify(y) ?? 'undefined',
    })
  }
  walk(normaliseMdast(a), normaliseMdast(b), '')
  return diffs
}
