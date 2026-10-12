/**
 * `@quill/markdown/drawio`: draw.io diagrams (ADR-043), the reference
 * Markdown extension. Shared by the server, which reads a diagram's labels
 * for search, and the editor, which opens its source in the draw.io editor.
 */
export {
  DRAWIO_EXTENSION_ID,
  EDIT_DIAGRAM,
  drawioExtension,
  drawioFilename,
  isDrawioFilename,
} from './drawio-extension.ts'
export {
  DRAWIO_LIMITS,
  decodeEntities,
  drawioSourceOf,
  editableDrawioSource,
  labelsOfModel,
  readDrawioLabels,
  readDrawioModels,
} from './drawio-file.ts'
export type {
  DrawioLabels,
  EditableDrawioSource,
  DrawioLimits,
  DrawioModels,
  DrawioRefusal,
  Inflate,
  Inflated,
} from './drawio-file.ts'
export { isDrawioDrawing, renderDrawioDrawing, withoutDrawioSource } from './drawio-svg.ts'
