import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useApiClient } from './client-context.tsx'

describe('useApiClient', () => {
  it('throws when used outside an ApiClientProvider', () => {
    expect(() => renderHook(() => useApiClient())).toThrow(
      'useApiClient must be used within an ApiClientProvider',
    )
  })
})
