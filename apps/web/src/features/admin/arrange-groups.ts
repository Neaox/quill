import type { GroupSummaryDto } from '../../lib/api/index.ts'

export interface GroupRow {
  readonly group: GroupSummaryDto
  /** How many groups it nests inside: 0 for one at the top of its unit. */
  readonly depth: number
}

export interface UnitSection {
  readonly unitId: string
  readonly unitPath: string
  readonly rows: readonly GroupRow[]
}

/**
 * The server's flat list as the screen shows it: a section per unit, and
 * inside it each group followed by the groups nested in it.
 *
 * The server already orders by unit path and then name, so sections keep the
 * order units first appear in and siblings keep the order they arrived in. A
 * group whose parent is not in the list is shown at the top of its unit rather
 * than dropped, so nothing an administrator could need to reach is hidden.
 */
export function arrangeGroups(groups: readonly GroupSummaryDto[]): readonly UnitSection[] {
  const byUnit = Object.groupBy(groups, (group) => group.unitId)

  return Object.values(byUnit).flatMap((members) => {
    const [first] = members ?? []
    if (members === undefined || first === undefined) return []

    const ids = new Set(members.map((member) => member.id))
    const childrenOf = Object.groupBy(members, (member) =>
      member.parentGroupId !== null && ids.has(member.parentGroupId) ? member.parentGroupId : '',
    )
    const walk = (parentKey: string, depth: number): GroupRow[] =>
      (childrenOf[parentKey] ?? []).flatMap((group) => [
        { group, depth },
        ...walk(group.id, depth + 1),
      ])

    return [{ unitId: first.unitId, unitPath: first.unitPath, rows: walk('', 0) }]
  })
}
