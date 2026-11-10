import type {
  DocumentFormat,
  DocumentInspection,
  RenderedContent,
  RenderInput,
} from './document-format.ts'

/**
 * The CPU-bound half of the document format, asked for in batches so it can
 * run on several threads at once (ADR-062, step 3): reading what a document
 * says about itself, and rendering a body. The answers are in the order the
 * inputs were given, whatever order they were computed in, so a batch is as
 * deterministic as the same calls made one at a time.
 *
 * The server's adapter is a pool of worker threads, each holding its own
 * copy of the format; `inlineDocumentWork` is the same work on the calling
 * thread, for a process with no pool and as the reference a pool is held to.
 */
export interface DocumentWork {
  inspect(markdowns: readonly string[]): Promise<readonly DocumentInspection[]>
  render(inputs: readonly RenderInput[]): Promise<readonly RenderedContent[]>
}

/** The work done one item at a time on the calling thread. */
export function inlineDocumentWork(
  format: Pick<DocumentFormat, 'inspect' | 'render'>,
): DocumentWork {
  return {
    inspect: async (markdowns) => markdowns.map((markdown) => format.inspect(markdown)),
    render: async (inputs) => inputs.map((input) => format.render(input)),
  }
}
