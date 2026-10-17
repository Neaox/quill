import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { lazyDialog } from './lazy-dialog.tsx'

interface ProbeProps {
  readonly open: boolean
  readonly label: string
}

function Probe({ open, label }: ProbeProps) {
  return <p>{open ? `${label} open` : `${label} closed`}</p>
}

function loader() {
  return vi.fn<() => Promise<{ default: typeof Probe }>>(async () => ({ default: Probe }))
}

describe('lazyDialog', () => {
  it('fetches nothing while the dialog has never been opened', () => {
    const load = loader()
    const Dialog = lazyDialog(load, 'Opening probe')

    render(<Dialog open={false} label="probe" />)

    expect(load).not.toHaveBeenCalled()
    expect(screen.queryByText(/probe/)).toBeNull()
  })

  it('says it is opening while the code arrives, then draws the dialog', async () => {
    const Dialog = lazyDialog(loader(), 'Opening probe')

    render(<Dialog open label="probe" />)

    expect(screen.getByRole('progressbar', { name: 'Opening probe' })).toBeInTheDocument()
    expect(await screen.findByText('probe open')).toBeInTheDocument()
  })

  it('stays mounted once loaded, so closing is the dialog’s own exit', async () => {
    const load = loader()
    const Dialog = lazyDialog(load, 'Opening probe')
    const view = render(<Dialog open={false} label="probe" />)

    view.rerender(<Dialog open label="probe" />)
    await screen.findByText('probe open')
    view.rerender(<Dialog open={false} label="probe" />)

    expect(screen.getByText('probe closed')).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(1)
  })
})
