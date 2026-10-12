import { uniqueBy } from 'remeda'

import { cssString } from './css-string.ts'
import { CURATED_FACE_FILES, SUBSET_UNICODE_RANGES } from './schema/face-files.ts'
import { curatedFace, type CuratedFaceId } from './schema/faces.ts'
import type { FaceReference, ThemeDocument } from './schema/theme-document.ts'

/**
 * The `@font-face` rules for the faces a theme names (ADR-028).
 *
 * The generated palette says *which* family each role is set in
 * (`--font-*`); a page also needs the browser told *where* that family's
 * files are. The application's bundle does that for the whole curated set in
 * `packages/ui/src/styles/fonts.css`; a page with no bundle behind it — the
 * public site — gets these rules in its theme stylesheet instead, for the
 * faces its theme names and no others.
 *
 * An uploaded face is declared only when it is served from this origin (a
 * rooted path): the content security policy's `font-src 'self'` would refuse
 * anything else, and a rule the browser is bound to refuse is noise.
 */

export type FontFaceOptions = {
  /** Where a curated face's file is served: its package and its file name in, a URL out. */
  readonly curatedHref: (packageName: string, file: string) => string
}

const key = (face: FaceReference): string =>
  face.source === 'curated' ? `curated:${face.id}` : `uploaded:${face.family}:${face.url}`

/** The distinct faces a theme names, in role order: display, reading, interface, mono. */
export const themeFaces = (theme: ThemeDocument): readonly FaceReference[] =>
  uniqueBy([theme.type.display, theme.type.reading, theme.type.interface, theme.type.mono], key)

/** Rooted at this origin: `/x`, and neither `//host` nor `/\host`, which a browser reads as one. */
const isSameOrigin = (url: string): boolean => /^\/(?![/\\])/u.test(url)

const rule = (declarations: readonly string[]): string =>
  ['@font-face {', ...declarations.map((line) => `  ${line}`), '}'].join('\n')

const curatedRules = (id: CuratedFaceId, options: FontFaceOptions): readonly string[] => {
  const family = cssString(curatedFace(id).family)
  const { package: packageName, files } = CURATED_FACE_FILES[id]
  return files.map((file) =>
    rule([
      `font-family: ${family};`,
      `font-style: ${file.style};`,
      `font-weight: ${file.weight};`,
      'font-display: swap;',
      `src: url(${cssString(options.curatedHref(packageName, file.file))}) format('woff2');`,
      `unicode-range: ${SUBSET_UNICODE_RANGES[file.subset]};`,
    ]),
  )
}

const faceRules = (face: FaceReference, options: FontFaceOptions): readonly string[] => {
  if (face.source === 'curated') return curatedRules(face.id, options)
  if (!isSameOrigin(face.url)) return []
  return [
    rule([
      `font-family: ${cssString(face.family)};`,
      'font-display: swap;',
      `src: url(${cssString(face.url)});`,
    ]),
  ]
}

export const fontFaceCss = (theme: ThemeDocument, options: FontFaceOptions): string =>
  themeFaces(theme)
    .flatMap((face) => faceRules(face, options))
    .join('\n\n')
