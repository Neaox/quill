import { describe, expect, it } from 'vitest'

import { decodeCodeIndexArtifact, encodeCodeIndexArtifact } from '../artifact.ts'
import { buildCodeIndex, discoverSourceFiles } from './build.ts'

const root = process.cwd()

describe('TypeScript extractor', () => {
  it('reads a class as a type and its members as symbols under it', () => {
    const artifact = buildCodeIndex({
      root,
      scopes: ['packages/content-store'],
      files: ['packages/content-store/src/git-content-store.ts'],
      tool: 'test',
      generatedAt: '2026-11-12T12:00:00.000Z',
    })

    const file = artifact.files['packages/content-store/src/git-content-store.ts']
    const members = file?.symbols.filter((symbol) => symbol.parent !== undefined) ?? []
    const head = members.find((symbol) => symbol.name === 'head')
    expect(file?.symbols.find((symbol) => symbol.name === 'GitContentStore')?.kind).toBe('class')
    expect(head).toMatchObject({
      kind: 'method',
      parent: { name: 'GitContentStore' },
    })
    expect(head?.moniker).toBe(
      'typescript:@quill/content-store:packages/content-store/src/git-content-store.ts#GitContentStore.head',
    )
    expect(members.some((symbol) => symbol.name === '#now')).toBe(false)
  })

  it('reads a TSX component from an app', () => {
    const artifact = buildCodeIndex({
      root,
      scopes: ['apps/web'],
      files: ['apps/web/src/features/workspaces/route-notice.tsx'],
      tool: 'test',
      generatedAt: '2026-11-12T12:00:00.000Z',
    })

    const file = artifact.files['apps/web/src/features/workspaces/route-notice.tsx']
    expect(file).toBeDefined()
    expect(file?.symbols.map((symbol) => symbol.name)).toContain('RouteNotice')
    expect(file?.symbols.find((symbol) => symbol.name === 'RouteNotice')?.module).toBe(
      'features/workspaces/route-notice',
    )
  })

  it('discovers TSX files and leaves its tests out', () => {
    const files = discoverSourceFiles(root, ['apps/web'])
    expect(files).toContain('apps/web/src/features/workspaces/route-notice.tsx')
    expect(files.some((file) => file.endsWith('.test.tsx'))).toBe(false)
  })

  it('reads a real Quill module into the artifact', () => {
    const artifact = buildCodeIndex({
      root,
      scopes: ['packages/domain'],
      files: ['packages/domain/src/result.ts'],
      tool: 'test',
      generatedAt: '2026-11-12T12:00:00.000Z',
    })

    const file = artifact.files['packages/domain/src/result.ts']
    expect(file).toBeDefined()
    const names = file?.symbols.map((symbol) => symbol.name) ?? []
    expect(names).toContain('Result')
    expect(names).toContain('ok')
    expect(names).toContain('err')
    expect(
      file?.symbols.every((symbol) => symbol.moniker.startsWith('typescript:@quill/domain:')),
    ).toBe(true)
    const result = file?.symbols.find((symbol) => symbol.name === 'Result')
    expect(result?.definition).toContain('type Result')
    const ok = file?.symbols.find((symbol) => symbol.name === 'ok')
    expect(ok?.typeRefs?.map((reference) => reference.name)).toContain('Result')

    const decoded = decodeCodeIndexArtifact(encodeCodeIndexArtifact(artifact))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.value.files['packages/domain/src/result.ts']?.symbols).toHaveLength(
      file?.symbols.length ?? 0,
    )
  })
})
