import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useCustomProperty } from './use-custom-property.ts'

function Painted({ value }: { readonly value: string }) {
  return <span data-testid="painted" ref={useCustomProperty('--paint', value)} />
}

describe('useCustomProperty', () => {
  it('writes the property onto the element and keeps it in step', () => {
    const { getByTestId, rerender } = render(<Painted value="red" />)
    expect(getByTestId('painted').style.getPropertyValue('--paint')).toBe('red')

    rerender(<Painted value="blue" />)
    expect(getByTestId('painted').style.getPropertyValue('--paint')).toBe('blue')
  })

  it('removes what it wrote when the element goes', () => {
    const { getByTestId, unmount } = render(<Painted value="red" />)
    const element = getByTestId('painted')
    unmount()
    expect(element.style.getPropertyValue('--paint')).toBe('')
  })
})
