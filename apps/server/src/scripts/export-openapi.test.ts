import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  buildOpenApiDocument,
  countOperations,
  DEFAULT_OPENAPI_PATH,
  exportOpenApi,
} from './export-openapi.ts'

/**
 * The description is generated from the routes themselves, with nothing behind
 * them: if a route is added and this changes, the client changes with it.
 */

describe('buildOpenApiDocument', () => {
  it('describes every route the server registers', async () => {
    const description = await buildOpenApiDocument()
    const paths = Object.keys(description.paths)

    expect(description.openapi).toMatch(/^3\./)
    expect(paths).toEqual(
      expect.arrayContaining([
        '/healthz',
        '/api/me',
        '/api/workspaces/{id}/tree',
        '/api/workspaces/{workspaceId}/documents',
        '/api/documents/{id}',
        '/api/documents/{id}/content',
        '/api/documents/{id}/rendered',
        '/api/documents/{id}/envelope',
        '/api/documents/{id}/publish',
        '/api/documents/{id}/restore',
        '/api/documents/{id}/history',
        '/api/documents/{id}/diff',
        '/api/documents/{id}/draft',
        '/api/documents/{id}/lock/acquire',
      ]),
    )
    expect(countOperations(description)).toBeGreaterThanOrEqual(paths.length)
  })

  it('resolves the recursive shapes through shared components', async () => {
    const description = (await buildOpenApiDocument()) as unknown as {
      components: { schemas: Record<string, unknown> }
    }
    expect(Object.keys(description.components.schemas)).toEqual(
      expect.arrayContaining(['OutlineEntry', 'TreeNode']),
    )
  })
})

describe('exportOpenApi', () => {
  it('writes the description where the client generator reads it', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'quill-openapi-'))
    const file = path.join(directory, 'openapi.gen.json')

    const result = await exportOpenApi(file)
    expect(result.file).toBe(file)
    expect(result.paths.length).toBeGreaterThan(0)
    expect(result.operations).toBeGreaterThan(result.paths.length)

    const written: unknown = JSON.parse(await readFile(file, 'utf8'))
    expect(Object.keys((written as { paths: object }).paths)).toEqual(result.paths)
  })

  it('defaults to the api-client package', () => {
    expect(DEFAULT_OPENAPI_PATH.replaceAll('\\', '/')).toContain(
      'packages/api-client/openapi.gen.json',
    )
  })
})

describe('countOperations', () => {
  it('counts methods and ignores everything else on a path', () => {
    expect(
      countOperations({
        openapi: '3.0.3',
        paths: { '/a': { get: {}, post: {}, parameters: [], summary: 'ignored' } },
      }),
    ).toBe(2)
  })
})
