import { describe, expect, it } from 'vitest'

import { fileNameOf } from './file-name.ts'

describe('fileNameOf', () => {
  it('takes the name the host suggests, over the address', () => {
    expect(
      fileNameOf('attachment; filename="Q3 report.pdf"', 'https://files.example/dl?id=7'),
    ).toBe('Q3 report.pdf')
  })

  it('reads an unquoted name', () => {
    expect(fileNameOf('attachment; filename=report.pdf', 'https://files.example/x')).toBe(
      'report.pdf',
    )
  })

  it('prefers the extended, percent-encoded form, which can carry any script', () => {
    expect(
      fileNameOf(
        'attachment; filename="fallback.pdf"; filename*=UTF-8\'\'%E6%97%A5%E6%9C%AC.pdf',
        'https://files.example/x',
      ),
    ).toBe('日本.pdf')
  })

  it('falls back to the last segment of the address, decoded', () => {
    expect(fileNameOf(null, 'https://files.example/a/b/Design%20spec.pdf?v=2#top')).toBe(
      'Design spec.pdf',
    )
  })

  it('has no name for an address that ends in a directory', () => {
    expect(fileNameOf(null, 'https://files.example/a/')).toBeNull()
    expect(fileNameOf(null, 'https://files.example/')).toBeNull()
  })

  it('never lets a path through: a name is one file name', () => {
    expect(fileNameOf('attachment; filename="../../etc/passwd"', 'https://f.example/x')).toBe(
      'passwd',
    )
    expect(fileNameOf('attachment; filename="C:\\temp\\evil.exe"', 'https://f.example/x')).toBe(
      'evil.exe',
    )
  })

  it('cleans what a stranger wrote: control characters, direction overrides and length', () => {
    expect(fileNameOf('attachment; filename="a\u202Eb\u0000c.txt"', 'https://f.example/x')).toBe(
      'ab c.txt',
    )
    const long = `${'x'.repeat(300)}.pdf`
    expect(
      [...(fileNameOf(`attachment; filename="${long}"`, 'https://f.example/x') ?? '')].length,
    ).toBeLessThanOrEqual(120)
  })

  it('ignores an extended name that is not valid percent-encoding', () => {
    expect(
      fileNameOf("attachment; filename*=UTF-8''%E0%A4%A", 'https://files.example/ok.pdf'),
    ).toBe('ok.pdf')
  })
})
