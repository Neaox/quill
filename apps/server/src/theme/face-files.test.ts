import { describe, expect, it } from 'vitest'
import { CURATED_FACE_FILES, CURATED_FACE_IDS } from '@quill/theme'

import {
  createFaceFiles,
  FONT_ROUTE_PREFIX,
  loadFaceFiles,
  SERVED_FONT_NAME,
  type FaceFiles,
} from './face-files.ts'

const interAddress = (files: FaceFiles): string =>
  files.href('@fontsource-variable/inter', 'inter-latin-wght-normal.woff2')

describe('the curated face files', () => {
  it('serves each file under its own name with a hash of its bytes in it', async () => {
    const files = await createFaceFiles(async (_packageName, file) => Buffer.from(file))
    const href = files.href('@fontsource-variable/inter', 'inter-latin-wght-normal.woff2')
    const name = href.slice(`${FONT_ROUTE_PREFIX}/`.length)
    expect(name).toMatch(SERVED_FONT_NAME)
    expect(name.startsWith('inter-latin-wght-normal.')).toBe(true)
    expect(files.byName(name)?.bytes.toString()).toBe('inter-latin-wght-normal.woff2')
  })

  it('changes the address when the bytes change, so an immutable copy is never stale', async () => {
    const before = await createFaceFiles(async () => Buffer.from('one'))
    const after = await createFaceFiles(async () => Buffer.from('two'))
    expect(interAddress(before)).not.toBe(interAddress(after))
  })

  it('knows nothing it was not given', async () => {
    const files = await createFaceFiles(async () => Buffer.from('x'))
    expect(files.byName('inter-latin-wght-normal.0000000000000000.woff2')).toBeNull()
    expect(files.byName('../package.json')).toBeNull()
    expect(() => files.href('@fontsource/nothing', 'nothing.woff2')).toThrow(
      'No curated face file @fontsource/nothing/nothing.woff2',
    )
  })

  it('reads every catalogued file from the packages this server depends on, once', async () => {
    const files = await loadFaceFiles()
    for (const id of CURATED_FACE_IDS) {
      const { package: packageName, files: catalogued } = CURATED_FACE_FILES[id]
      for (const { file } of catalogued) {
        const served = files.byName(files.href(packageName, file).split('/').at(-1) ?? '')
        // Every woff2 file opens with its signature.
        expect(served?.bytes.subarray(0, 4).toString('latin1')).toBe('wOF2')
      }
    }
    expect(await loadFaceFiles()).toBe(files)
  })
})
