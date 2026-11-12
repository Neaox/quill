/**
 * What the editor needs of math (ADR-064): to draw a formula, as DOM, with the same library and
 * the same checks the server draws it with. Kept apart from the Markdown syntax (`index.ts`) so
 * that the editor's chunk holds Temml and nothing of the parser.
 */
export { mathDom } from './dom.ts'
export { STYLE_CLASSES } from './grant.ts'
export { MAX_TEX_LENGTH, renderMath } from './tree.ts'
export type { MathElement, MathRendering } from './tree.ts'
