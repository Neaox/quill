import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  CURATED_FACE_FILES,
  CURATED_FACE_IDS,
  SUBSET_UNICODE_RANGES,
  curatedFace,
} from '@quill/theme'

/**
 * `fonts.css` and `@quill/theme`'s face catalogue describe the same files.
 *
 * The application declares the curated faces by hand, here, because Vite has
 * to see each `url()` to emit the file; the server declares them from the
 * catalogue, for pages that have no bundle behind them (the public site). A
 * face added to one and not the other would look right in the application and
 * fall back to a system font on the web, which is the drift this test exists
 * to make a failure instead.
 */

// Through a variable: Vite rewrites `new URL('<literal>', import.meta.url)`
// into an asset address, which is not a file this test can read.
const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const fontsCss = read('fonts.css')

const declaration = (block: string, property: string): string =>
  block
    .match(new RegExp(`${property}:\\s*([^;]*);`, 'u'))?.[1]
    ?.replaceAll(/\s+/gu, ' ')
    .trim() ?? ''

const declared = [...fontsCss.matchAll(/@font-face\s*\{([^}]*)\}/gu)].map(([, block = '']) => {
  const source = /node_modules\/(?<pkg>@[^/]+\/[^/]+)\/files\/(?<file>[^'"]+)/u.exec(
    declaration(block, 'src'),
  )?.groups
  return [
    declaration(block, 'font-family').replaceAll("'", ''),
    declaration(block, 'font-style'),
    declaration(block, 'font-weight'),
    source?.['pkg'],
    source?.['file'],
    declaration(block, 'unicode-range'),
  ].join(' | ')
})

const catalogued = CURATED_FACE_IDS.flatMap((id) =>
  CURATED_FACE_FILES[id].files.map((file) =>
    [
      curatedFace(id).family,
      file.style,
      file.weight,
      CURATED_FACE_FILES[id].package,
      file.file,
      SUBSET_UNICODE_RANGES[file.subset],
    ].join(' | '),
  ),
)

describe('the curated type set, as the application and the server see it', () => {
  it('declares exactly the files the catalogue lists, with the same descriptors', () => {
    expect(declared.toSorted()).toEqual(catalogued.toSorted())
  })
})
