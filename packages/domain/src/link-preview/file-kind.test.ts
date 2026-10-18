import { describe, expect, it } from 'vitest'

import {
  FILE_MEDIA_TYPE_PATTERNS,
  fileKindOf,
  fileMeta,
  fileTypeLabel,
  formatFileSize,
} from './file-kind.ts'

describe('fileKindOf', () => {
  it.each([
    ['image/png', 'image'],
    ['image/svg+xml', 'image'],
    ['application/pdf', 'pdf'],
    ['video/mp4', 'video'],
    ['audio/mpeg', 'audio'],
    ['application/msword', 'document'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document'],
    ['application/vnd.oasis.opendocument.text', 'document'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'spreadsheet'],
    ['text/csv', 'spreadsheet'],
    ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'presentation'],
    ['text/plain', 'text'],
    ['text/markdown', 'text'],
    ['application/zip', 'archive'],
  ] as const)('reads %s as %s', (mediaType, kind) => {
    expect(fileKindOf(mediaType)).toBe(kind)
  })

  it('is case-insensitive about the type', () => {
    expect(fileKindOf('Application/PDF')).toBe('pdf')
  })

  it.each([
    'text/html',
    'application/json',
    'application/octet-stream',
    'application/x-msdownload',
    '',
  ])('does not take %j for a file worth a card', (mediaType) => {
    expect(fileKindOf(mediaType)).toBeNull()
  })

  it('lists the patterns a request can ask the client to answer from headers alone', () => {
    expect(FILE_MEDIA_TYPE_PATTERNS).toContain('image/*')
    expect(FILE_MEDIA_TYPE_PATTERNS).toContain('application/pdf')
    expect(FILE_MEDIA_TYPE_PATTERNS).not.toContain('text/html')
    // An executable or an unknown download is never offered as a file.
    expect(FILE_MEDIA_TYPE_PATTERNS).not.toContain('application/octet-stream')
  })
})

describe('formatFileSize', () => {
  it.each([
    [0, '0 B'],
    [999, '999 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [12 * 1024 * 1024, '12 MB'],
    [3.4 * 1024 * 1024 * 1024, '3.4 GB'],
  ])('writes %d bytes as %s', (bytes, written) => {
    expect(formatFileSize(bytes)).toBe(written)
  })

  it('writes nothing for a size nobody declared', () => {
    expect(formatFileSize(null)).toBeNull()
  })
})

describe('fileTypeLabel', () => {
  it.each([
    ['application/pdf', 'PDF document'],
    ['image/png', 'PNG image'],
    ['image/jpeg', 'JPEG image'],
    ['image/svg+xml', 'SVG image'],
    ['image/vnd.microsoft.icon', 'Image'],
    ['video/mp4', 'MP4 video'],
    ['video/quicktime', 'Video'],
    ['audio/mpeg', 'Audio'],
    ['audio/ogg', 'OGG audio'],
    ['application/msword', 'Word document'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Word document'],
    ['application/vnd.oasis.opendocument.text', 'Document'],
    ['text/csv', 'CSV file'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Spreadsheet'],
    ['application/vnd.ms-powerpoint', 'Presentation'],
    ['text/plain', 'Text file'],
    ['text/markdown', 'Markdown file'],
    ['application/zip', 'ZIP archive'],
    ['application/x-tar', 'Archive'],
  ])('calls %s %j', (mediaType, label) => {
    expect(fileTypeLabel(mediaType)).toBe(label)
  })

  it('has no label for what is not a file', () => {
    expect(fileTypeLabel('text/html')).toBeNull()
  })
})

describe('fileMeta', () => {
  it('says the type and, when it is known, the size', () => {
    expect(fileMeta({ mediaType: 'application/pdf', bytes: 482_113 })).toBe(
      'PDF document · 470.8 KB',
    )
    expect(fileMeta({ mediaType: 'application/pdf', bytes: null })).toBe('PDF document')
  })
})
