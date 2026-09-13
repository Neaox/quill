import { describe, expect, it } from 'vitest'
import { CURATED_FACE_IDS, CURATED_FACE_LIST, CURATED_FACES, curatedFace } from './faces.ts'

describe('the curated type set', () => {
  it('lists every face exactly once', () => {
    expect(CURATED_FACE_IDS).toHaveLength(CURATED_FACE_LIST.length)
    expect(new Set(CURATED_FACE_IDS).size).toBe(CURATED_FACE_IDS.length)
  })

  it('keys every face by its own id', () => {
    for (const id of CURATED_FACE_IDS) {
      expect(curatedFace(id).id).toBe(id)
    }
  })

  it('records a licence for every face, because shipping one needs it', () => {
    for (const face of CURATED_FACE_LIST) {
      expect(face.licence.name).toBe('OFL-1.1')
      expect(face.fallbacks.length).toBeGreaterThan(0)
      expect(face.roles.length).toBeGreaterThan(0)
    }
  })

  it('offers a monospace face only for the mono role', () => {
    expect(CURATED_FACES['jetbrains-mono'].roles).toEqual(['mono'])
    expect(CURATED_FACES['ibm-plex-mono'].roles).toEqual(['mono'])
  })
})
