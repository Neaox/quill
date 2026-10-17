/**
 * Document properties on their own (`@quill/editor/properties`): the byline a
 * reader sees and edits in place, without the editor around it.
 *
 * A surface that shows properties but no editor — the design showcase — imports
 * this entry rather than the package's, because the package's pulls in TipTap,
 * ProseMirror and every extension with it: under the dev server that is
 * several hundred more modules to fetch and evaluate before the page draws,
 * which on WebKit was the difference between the showcase drawing in time
 * and not (the end-to-end `design.spec.ts`).
 */
export { DocumentProperties, documentPropertiesStyles } from './document-properties.tsx'
export type { DocumentPropertiesProps } from './document-properties.tsx'
export type { PeopleDirectory, Person } from './people.ts'
