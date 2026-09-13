import { workspaceId } from '@quill/domain'
import { describe, expect, it } from 'vitest'

import type { SearchRequest } from './search-request.ts'

// Never invoked: this function exists only for `tsc` to check. Omitting
// `filter` must be a compile error, so `@ts-expect-error` is itself the
// assertion — `pnpm exec tsc --noEmit` fails if the error stops happening,
// which is what a widened `SearchRequest` would do.
function typeOnly(): void {
  // @ts-expect-error - `filter` is required on `SearchRequest`
  const request: SearchRequest = { queryText: 'hello' }
  void request
}
void typeOnly

describe('SearchRequest (type-level)', () => {
  it('cannot be built without a VisibilityFilter', () => {
    const withFilter: SearchRequest = {
      queryText: 'hello',
      filter: {
        workspaceIds: [workspaceId('11111111-1111-4111-8111-111111111111')],
        principalKeys: [],
      },
    }
    expect(withFilter.queryText).toBe('hello')
  })
})
