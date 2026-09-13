import { parseDocument } from '@quill/markdown'
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useTemplateProgress } from './use-template-progress.ts'

const TEMPLATE = [
  '---',
  'template:',
  '  name: Runbook',
  '  version: 1',
  '  sections:',
  '    - heading: Symptoms',
  '      required: true',
  '---',
  '',
  '## Symptoms',
  '',
  'The queue backs up.',
  '',
].join('\n')

describe('the template progress hook', () => {
  it('gives the checklist for the document it is given', () => {
    const { result } = renderHook(() => useTemplateProgress(parseDocument(TEMPLATE).ast))
    expect(result.current).toMatchObject({ name: 'Runbook', started: 1, total: 1 })
  })

  it('recomputes only when the AST changes', () => {
    const ast = parseDocument(TEMPLATE).ast
    const { result, rerender } = renderHook(({ tree }) => useTemplateProgress(tree), {
      initialProps: { tree: ast },
    })
    const first = result.current
    rerender({ tree: ast })
    expect(result.current).toBe(first)

    rerender({ tree: parseDocument(TEMPLATE.replace('The queue backs up.', '')).ast })
    expect(result.current).not.toBe(first)
    expect(result.current.started).toBe(0)
  })
})
