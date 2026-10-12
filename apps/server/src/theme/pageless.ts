import type { Hasher } from '@quill/application'

import { createPublicStylesheets, type PublicStylesheets } from '../public-site/stylesheet.ts'
import { createFaceFiles, type FaceFiles } from './face-files.ts'
import { createThemeStylesheets, type ThemeStylesheets } from './theme-stylesheet.ts'

/**
 * The stylesheet ports for a process that serves no page — the seed, the
 * secrets commands, the OpenAPI export.
 *
 * They are present because `AppDependencies` is one shape, and they read
 * nothing: no font file, no design-system CSS. A command that starts in a
 * second should not spend any of it reading a megabyte of fonts it will never
 * send.
 */
export async function pagelessStylesheets(hasher: Hasher): Promise<{
  readonly faceFiles: FaceFiles
  readonly themeStylesheets: ThemeStylesheets
  readonly publicStylesheets: PublicStylesheets
}> {
  const faceFiles = await createFaceFiles(async () => Buffer.alloc(0))
  const themeStylesheets = createThemeStylesheets({ hasher, faceFiles })
  return {
    faceFiles,
    themeStylesheets,
    publicStylesheets: createPublicStylesheets({ hasher, themeStylesheets, designSystemCss: '' }),
  }
}
