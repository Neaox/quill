import { describe, expect, it } from 'vitest'

import { ROLES, canComment, canEdit, canManage, canOwn, canView, roleAtLeast } from './roles.ts'

describe('roleAtLeast', () => {
  it('orders roles viewer < contributor < editor < admin < owner', () => {
    for (let i = 0; i < ROLES.length; i += 1) {
      for (let j = 0; j < ROLES.length; j += 1) {
        expect(roleAtLeast(ROLES[i]!, ROLES[j]!)).toBe(i >= j)
      }
    }
  })
})

describe('capabilities', () => {
  it.each([
    ['viewer', true, false, false, false, false],
    ['contributor', true, true, false, false, false],
    ['editor', true, true, true, false, false],
    ['admin', true, true, true, true, false],
    ['owner', true, true, true, true, true],
  ] as const)('%s', (role, view, comment, edit, manage, own) => {
    expect(canView(role)).toBe(view)
    expect(canComment(role)).toBe(comment)
    expect(canEdit(role)).toBe(edit)
    expect(canManage(role)).toBe(manage)
    expect(canOwn(role)).toBe(own)
  })
})
