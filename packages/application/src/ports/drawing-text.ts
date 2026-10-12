/**
 * The words a stored drawing carries, for search (ADR-043).
 *
 * A draw.io diagram's labels are in its embedded source, usually compressed,
 * which only the Markdown package knows how to read and only an adapter can
 * inflate (`apps/server/src/infrastructure/drawio`). The application asks this
 * port on upload and on each revision, and stores what it answers on the
 * attachment, so search never reads a file at query time.
 *
 * The adapter is where a hostile file is contained: it reads within fixed
 * limits on what it inflates and scans, and a file past them has no words
 * rather than costing the server what it asks for.
 */
export interface DrawingText {
  /** The file's words, one label per line, or null when it carries none this reader can read. */
  read(file: string): Promise<string | null>
}
