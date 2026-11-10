import { BRAND } from '@quill/brand'

import type { BlockIssueView, TableShapeView } from '../ports/document-format.ts'
import { authorLine, tableShapeWords } from './get-envelope.ts'
import type { RefusedSourceFile } from '../ports/source-sync.ts'
import { isSourceDocument } from './source-plan.ts'
import { byCodePoint } from './source-revision.ts'
import type { SourceHeadPlan } from './source-head-plan.ts'
import { describeManifestProblem } from './source-manifest.ts'

/**
 * What a sync of one revision would report about a source (ADR-062,
 * section 1): every problem that is a function of the repository's content
 * and that the server records, and no other. The command-line tool prints
 * it; the parity suite holds it to what the sync job recorded.
 *
 * Codes are stable strings. Problems are in code-point order of path, then
 * line, then code, then message, so the report is the same bytes on every
 * system and in every locale.
 */

export const SOURCE_REPORT_SCHEMA = `${BRAND.slug}-check/1`

export type SourceProblemSeverity = 'error' | 'warning' | 'note'

export type SourceProblemCode =
  | 'manifest-invalid'
  | 'manifest-entry'
  | 'manifest-unknown-key'
  | 'manifest-default'
  | 'file-too-large'
  | 'file-not-utf8'
  | 'file-symbolic-link'
  | 'asset-type-not-allowed'
  | 'asset-type-mismatch'
  | 'asset-empty'
  | 'asset-malformed'
  | 'asset-too-large'
  | 'link-broken'
  | 'block-issue'
  | 'table-shape'
  | 'required-section-empty'
  | 'left-out'
  | 'folder-generated'
  | 'folder-index'

export interface SourceProblem {
  readonly code: SourceProblemCode
  readonly severity: SourceProblemSeverity
  readonly path: string
  /** One-based; null when the problem is about the whole file. */
  readonly line: number | null
  readonly message: string
}

export interface SourceReport {
  readonly schema: typeof SOURCE_REPORT_SCHEMA
  readonly summary: {
    readonly errors: number
    readonly warnings: number
    readonly notes: number
    readonly documents: number
    readonly assets: number
  }
  readonly problems: readonly SourceProblem[]
}

/** What a document's render reported, by its stored path. */
export interface RenderedFindings {
  readonly blockIssues: readonly BlockIssueView[]
  readonly tableShapes: readonly TableShapeView[]
  readonly incompleteRequiredSections: readonly string[]
}

const REFUSED: Readonly<
  Record<
    RefusedSourceFile['reason'],
    { readonly code: SourceProblemCode; readonly asset: SourceProblemCode; readonly words: string }
  >
> = {
  'too-large': {
    code: 'file-too-large',
    asset: 'asset-too-large',
    words: 'It is too large to store.',
  },
  'not-utf8': { code: 'file-not-utf8', asset: 'file-not-utf8', words: 'It is not UTF-8 text.' },
  'symbolic-link': {
    code: 'file-symbolic-link',
    asset: 'file-symbolic-link',
    words: 'It is a symbolic link, which is never followed.',
  },
  'outside-collections': {
    code: 'left-out',
    asset: 'left-out',
    words: 'It is outside every collection.',
  },
  'type-not-allowed': {
    code: 'asset-type-not-allowed',
    asset: 'asset-type-not-allowed',
    words: 'Its contents are not a type an upload may be.',
  },
  'type-mismatch': {
    code: 'asset-type-mismatch',
    asset: 'asset-type-mismatch',
    words: 'Its contents are not what its file name says.',
  },
  empty: { code: 'asset-empty', asset: 'asset-empty', words: 'It is empty.' },
  malformed: {
    code: 'asset-malformed',
    asset: 'asset-malformed',
    words: 'Its picture could not be read, so its metadata could not be removed.',
  },
}

const SEVERITY: Readonly<Record<SourceProblemCode, SourceProblemSeverity>> = {
  'manifest-invalid': 'error',
  'manifest-entry': 'error',
  'manifest-unknown-key': 'warning',
  'manifest-default': 'note',
  'file-too-large': 'error',
  'file-not-utf8': 'error',
  'file-symbolic-link': 'error',
  'asset-type-not-allowed': 'error',
  'asset-type-mismatch': 'error',
  'asset-empty': 'error',
  'asset-malformed': 'error',
  'asset-too-large': 'error',
  'link-broken': 'warning',
  'block-issue': 'warning',
  'table-shape': 'warning',
  'required-section-empty': 'warning',
  'left-out': 'note',
  'folder-generated': 'note',
  'folder-index': 'note',
}

/** The report of a head plan, with what its documents' renders found, by stored path. */
export function reportSource(input: {
  readonly plan: SourceHeadPlan
  readonly rendered?: ReadonlyMap<string, RenderedFindings>
}): SourceReport {
  const { plan } = input
  const problems: SourceProblem[] = []
  const add = (code: SourceProblemCode, path: string, line: number | null, message: string) => {
    problems.push({ code, severity: SEVERITY[code], path, line, message })
  }

  if (plan.kind === 'unreadable') {
    add(
      plan.entryMissing ? 'manifest-entry' : 'manifest-invalid',
      plan.manifestPath,
      plan.problem.line,
      describeManifestProblem(plan.manifestPath, plan.problem),
    )
    return report(problems, 0, 0)
  }

  for (const { key, line } of plan.layout.unknownKeys) {
    add(
      'manifest-unknown-key',
      plan.layout.manifestPath,
      line,
      `${key} is not a key this version reads.`,
    )
  }
  for (const { line, message } of plan.layout.notes) {
    add('manifest-default', plan.layout.manifestPath, line, message)
  }
  for (const { path, reason } of plan.refused) {
    const refusal = REFUSED[reason]
    add(isSourceDocument(path) ? refusal.code : refusal.asset, path, null, refusal.words)
  }
  for (const { path, url } of plan.brokenLinks) {
    add('link-broken', path, null, `${url} leads to nothing in the repository.`)
  }
  for (const { path, pattern } of plan.leftOut) {
    add(
      'left-out',
      path,
      null,
      pattern === null ? 'No collection takes it.' : `Excluded by ${pattern}.`,
    )
  }
  for (const [folder, path] of plan.folders.indexes) {
    add('folder-index', path, null, `It is the document of ${folder === '' ? 'the top' : folder}.`)
  }
  for (const document of plan.documents) {
    if (document.generated) {
      add(
        'folder-generated',
        document.folder ?? document.path,
        null,
        `The folder has no index file, so ${BRAND.name} writes its page.`,
      )
    }
    const findings = input.rendered?.get(document.path)
    if (findings === undefined) continue
    for (const issue of findings.blockIssues) {
      // A line is the one in the repository's file, which the check reads (ADR-062).
      const line = issue.line === undefined ? null : authorLine(issue.line, document.lineOffset)
      add('block-issue', document.path, line, issue.message)
    }
    for (const shape of findings.tableShapes) {
      const line = shape.line === undefined ? null : authorLine(shape.line, document.lineOffset)
      add('table-shape', document.path, line, tableShapeWords(shape))
    }
    for (const heading of findings.incompleteRequiredSections) {
      add('required-section-empty', document.path, null, `The section "${heading}" is empty.`)
    }
  }
  return report(problems, plan.documents.length, plan.assets.length)
}

function report(problems: SourceProblem[], documents: number, assets: number): SourceReport {
  const sorted = problems.toSorted(
    (left, right) =>
      byCodePoint(left.path, right.path) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      byCodePoint(left.code, right.code) ||
      byCodePoint(left.message, right.message),
  )
  const count = (severity: SourceProblemSeverity) =>
    sorted.filter((problem) => problem.severity === severity).length
  return {
    schema: SOURCE_REPORT_SCHEMA,
    summary: {
      errors: count('error'),
      warnings: count('warning'),
      notes: count('note'),
      documents,
      assets,
    },
    problems: sorted,
  }
}
