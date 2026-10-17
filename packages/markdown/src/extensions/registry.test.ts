import { describe, expect, it } from 'vitest'

import type { MarkdownExtension } from './contract.ts'
import { defineExtension } from './contract.ts'
import { BUILT_IN_EXTENSIONS, createMarkdownRegistry } from './registry.ts'

const example = (overrides: Partial<MarkdownExtension> = {}): MarkdownExtension =>
  defineExtension({
    id: 'acme.boxes',
    version: '1.2.3',
    syntax: { kind: 'drawing', claims: ({ markup }) => markup.includes('acme') },
    render: ({ markup }) => ({
      kind: 'inline',
      markup,
      naturalSize: false,
      data: { 'data-acme': 'yes', 'data-sneaky': 'yes' },
    }),
    sanitize: { drawing: { data: ['data-acme'] } },
    editor: {
      view: 'image',
      insert: { label: 'Boxes', description: 'Boxes', keywords: [] },
      actions: [],
    },
    ...overrides,
  })

describe('createMarkdownRegistry', () => {
  it('installs Quill’s own extensions by default', () => {
    const registry = createMarkdownRegistry()
    expect(registry.extensions).toBe(BUILT_IN_EXTENSIONS)
    expect(registry.findExtension('quill.drawio')?.version).toBe('1.0.0')
    expect(registry.signature).toBe('quill.drawio@1.0.0')
  })

  it('signs the installed extensions in a stable order', () => {
    const registry = createMarkdownRegistry([example(), ...BUILT_IN_EXTENSIONS])
    expect(registry.signature).toBe('acme.boxes@1.2.3 quill.drawio@1.0.0')
  })

  it('asks the extension that claims a drawing, and keeps only what its grant names', () => {
    const registry = createMarkdownRegistry([example()])
    expect(registry.drawing({ markup: '<svg>acme</svg>' })).toEqual({
      kind: 'inline',
      markup: '<svg>acme</svg>',
      naturalSize: false,
      data: { 'data-acme': 'yes' },
    })
  })

  it('keeps no data from an extension whose grant names none', () => {
    const registry = createMarkdownRegistry([example({ sanitize: {} })])
    expect(registry.drawing({ markup: '<svg>acme</svg>' })).toEqual({
      kind: 'inline',
      markup: '<svg>acme</svg>',
      naturalSize: false,
      data: {},
    })
  })

  it('grants an image rendering only the image grant', () => {
    const registry = createMarkdownRegistry([
      example({ render: () => ({ kind: 'image', data: { 'data-acme': '' } }) }),
    ])
    expect(registry.drawing({ markup: 'acme' })).toEqual({ kind: 'image', data: {} })
  })

  it('draws an unclaimed drawing as it is', () => {
    expect(createMarkdownRegistry([example()]).drawing({ markup: '<svg/>' })).toEqual({
      kind: 'inline',
      markup: '<svg/>',
      naturalSize: false,
      data: {},
    })
  })

  it('refuses an extension that breaks the contract, saying how', () => {
    const untyped = { ...example(), editor: undefined } as unknown as MarkdownExtension
    expect(() => createMarkdownRegistry([untyped])).toThrow(
      'The Markdown extension "acme.boxes" cannot be installed: it has no editor binding.',
    )
    expect(() =>
      createMarkdownRegistry([
        example({ id: 'Boxes', version: '1', sanitize: { image: { data: ['onclick'] } } }),
      ]),
    ).toThrow(
      'its id "Boxes" is not dotted lowercase; its version "1" is not semver; its grant names "onclick", which is not a data attribute.',
    )
  })

  it('refuses two extensions with one id', () => {
    expect(() => createMarkdownRegistry([example(), example()])).toThrow(
      'Two Markdown extensions are called "acme.boxes"',
    )
  })
})
