/**
 * `@quill/editor/drawio`: the draw.io editing session (ADR-043), a chunk of
 * its own. The application imports it lazily, when somebody inserts or edits
 * a diagram, so neither the reading route nor an editor that never opens a
 * diagram pays for it. The editor binding — the slash item and the image
 * action — is in `@quill/editor` itself and is small.
 */
export { DrawioEditor } from './drawio-editor.tsx'
export type {
  DrawioDiagram,
  DrawioEditorProps,
  DrawioFiles,
  DrawioRevision,
  DrawioSaved,
  DrawioTarget,
} from './drawio-editor.tsx'
