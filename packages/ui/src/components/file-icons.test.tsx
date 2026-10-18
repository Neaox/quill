import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  FILE_ICON_KINDS,
  FILE_ICON_MARKS,
  FILE_ICON_PAGE,
  FileIcon,
  fileIconPaths,
} from './file-icons.tsx'

describe('FileIcon', () => {
  it.each(FILE_ICON_KINDS)('draws %s as the page and its own mark, decoratively', (kind) => {
    const { container } = render(<FileIcon kind={kind} className="size-8" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveClass('size-8')
    expect([...container.querySelectorAll('path')].map((path) => path.getAttribute('d'))).toEqual(
      fileIconPaths(kind),
    )
  })

  it('gives every kind a mark of its own, so no two icons are the same drawing', () => {
    expect(new Set(Object.values(FILE_ICON_MARKS)).size).toBe(FILE_ICON_KINDS.length)
  })
})

describe('the reading stylesheet draws the same icons', () => {
  const css = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../design-css/src/prose.css'),
    'utf8',
  )

  it.each(FILE_ICON_KINDS)('has the paths of %s, and only those', (kind) => {
    const rule = new RegExp(
      String.raw`\.link-file-icon\[data-file-kind='${kind}'\]\s*\{([^}]*)\}`,
      'u',
    ).exec(css)?.[1]
    expect(rule).toBeDefined()
    const paths = [...(rule ?? '').matchAll(/%3Cpath d='([^']+)'\/%3E/gu)].map((match) => match[1])
    expect(paths).toEqual([FILE_ICON_PAGE, FILE_ICON_MARKS[kind]])
  })
})
