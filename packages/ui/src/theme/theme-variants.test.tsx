import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ThemeVariantsProvider, useThemeVariants } from './theme-variants.tsx'

function Report() {
  const variants = useThemeVariants()
  return <p>{`${variants.header}/${variants.history}/${variants.navigation}`}</p>
}

describe('theme variants in scope', () => {
  it('are the default identity when nothing provides them', () => {
    render(<Report />)

    expect(screen.getByText('readout/timeline/tree')).toBeInTheDocument()
  })

  it('are the provided identity below a provider', () => {
    render(
      <ThemeVariantsProvider themeId="press">
        <Report />
      </ThemeVariantsProvider>,
    )

    expect(screen.getByText('breadcrumb/menu/tree')).toBeInTheDocument()
  })
})
