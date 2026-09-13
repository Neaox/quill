import type { ContentChange } from '@quill/application'
import { describe, expect, it } from 'vitest'

import { CHANGE_NOTE_TRAILER, DOCUMENT_ID_TRAILER } from './branding.ts'
import { buildCommitMessage } from './commit-message.ts'
import { parseTrailers, trailerValues } from './git/trailers.ts'
import { markdown, newDocument, write } from './test-fixtures.ts'

const ID = newDocument()
const OTHER = newDocument()
const TITLED = markdown(ID, 'Onboarding')

const subject = (message: string): string => message.split('\n')[0] ?? ''

describe('buildCommitMessage subject', () => {
  it('prefers the summary the caller supplied', () => {
    const message = buildCommitMessage({
      changes: [write(ID, 'a.md', TITLED)],
      summary: 'Restore Onboarding to its previous revision',
    })
    expect(subject(message)).toBe('Restore Onboarding to its previous revision')
  })

  it('folds a multi-line summary onto the subject line', () => {
    const message = buildCommitMessage({ changes: [write(ID, 'a.md', TITLED)], summary: 'a\nb' })
    expect(subject(message)).toBe('a b')
  })

  it('names the document by its front-matter title', () => {
    const message = buildCommitMessage({ changes: [write(ID, 'handbook/a.md', TITLED)] })
    expect(subject(message)).toBe('Update Onboarding')
  })

  it('falls back to the file name when a document has no title', () => {
    const message = buildCommitMessage({ changes: [write(ID, 'handbook/deep-dive.md', '# Hi\n')] })
    expect(subject(message)).toBe('Update deep-dive')
  })

  it('describes a move', () => {
    const change: ContentChange = {
      kind: 'move',
      documentId: ID,
      fromPath: 'a.md',
      toPath: 'b/c.md',
      markdown: TITLED,
    }
    expect(subject(buildCommitMessage({ changes: [change] }))).toBe('Move Onboarding')
  })

  it('describes a move that carries no new content', () => {
    const change: ContentChange = { kind: 'move', documentId: ID, fromPath: 'a.md', toPath: 'b.md' }
    expect(subject(buildCommitMessage({ changes: [change] }))).toBe('Move b')
  })

  it('describes a delete', () => {
    const change: ContentChange = { kind: 'delete', documentId: ID, path: 'handbook/a.md' }
    expect(subject(buildCommitMessage({ changes: [change] }))).toBe('Delete a')
  })

  it('counts the documents in a bulk publish', () => {
    const message = buildCommitMessage({
      changes: [write(ID, 'a.md', TITLED), write(OTHER, 'b.md', TITLED)],
    })
    expect(subject(message)).toBe('Publish 2 documents')
  })
})

describe('buildCommitMessage trailers', () => {
  it('records every changed document once, in order', () => {
    const message = buildCommitMessage({
      changes: [write(ID, 'a.md', TITLED), write(OTHER, 'b.md', TITLED), write(ID, 'c.md', TITLED)],
    })
    expect(trailerValues(parseTrailers(message), DOCUMENT_ID_TRAILER)).toEqual([ID, OTHER])
  })

  it('omits the change note when there is none', () => {
    const message = buildCommitMessage({ changes: [write(ID, 'a.md', TITLED)] })
    expect(trailerValues(parseTrailers(message), CHANGE_NOTE_TRAILER)).toEqual([])
  })

  it('folds a multi-line change note so the whole block stays readable', () => {
    const message = buildCommitMessage({
      changes: [write(ID, 'a.md', TITLED)],
      changeNote: 'First line.\nSecond line.\n\nFourth line.',
    })
    const trailers = parseTrailers(message)
    expect(trailerValues(trailers, CHANGE_NOTE_TRAILER)).toEqual([
      'First line. Second line. Fourth line.',
    ])
    expect(trailerValues(trailers, DOCUMENT_ID_TRAILER)).toEqual([ID])
  })

  it('separates the subject from the trailers with a blank line', () => {
    const message = buildCommitMessage({ changes: [write(ID, 'a.md', TITLED)] })
    expect(message).toBe(`Update Onboarding\n\n${DOCUMENT_ID_TRAILER}: ${ID}\n`)
  })
})
