import type { DocumentId } from '@quill/domain'
import { describe, expect, it } from 'vitest'

import { createTrailReader } from './trail.ts'

const id = (name: string) => name as DocumentId
const page = (name: string, parent: string | null) => ({
  id: id(name),
  parentId: parent === null ? null : id(parent),
  title: name.toUpperCase(),
})

describe('createTrailReader', () => {
  const trailOf = createTrailReader([
    page('guides', null),
    page('api', 'guides'),
    page('limits', 'api'),
    page('orphan', 'carved-out'),
  ])

  it('is empty for a page at the top of the site', () => {
    expect(trailOf(id('guides'))).toEqual([])
  })

  it('names the pages above, outermost first', () => {
    expect(trailOf(id('limits'))).toEqual(['GUIDES', 'API'])
  })

  it('stops where the site stops: a parent that is not on it is not named', () => {
    expect(trailOf(id('orphan'))).toEqual([])
  })

  it('answers for a page it was not given as no trail at all', () => {
    expect(trailOf(id('elsewhere'))).toEqual([])
  })

  it('survives a loop in the data rather than spinning', () => {
    const loop = createTrailReader([page('a', 'b'), page('b', 'a')])
    expect(loop(id('a')).length).toBeLessThanOrEqual(2)
  })
})
