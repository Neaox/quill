import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { DocumentBody } from './document-body.tsx'

/* jsdom has no modal dialogs; these stand in for the two calls the viewer makes. */
function openDialog(this: HTMLDialogElement): void {
  this.setAttribute('open', '')
}

function closeDialog(this: HTMLDialogElement): void {
  this.removeAttribute('open')
  this.dispatchEvent(new Event('close'))
}

const TITLED = '<article><h1 id="the-sync-map">The sync map</h1><p>How things move.</p></article>'

async function mounted(html: string, eyebrow?: string) {
  const view = render(
    <DocumentBody
      html={html}
      label="The sync map"
      {...(eyebrow === undefined ? {} : { eyebrow })}
    />,
  )
  const article = screen.getByRole('article', { name: 'The sync map' })
  await waitFor(() => {
    expect(article.childElementCount).toBeGreaterThan(0)
  })
  return { ...view, article }
}

describe('DocumentBody', () => {
  it('puts what it is given straight under the body’s own title, across a new revision', async () => {
    const { article, rerender } = await mounted(TITLED)
    rerender(<DocumentBody html={TITLED} label="The sync map" afterTitle={<p>Facts</p>} />)
    const slot = article.querySelector('[data-byline-slot]')
    expect(slot?.previousElementSibling?.tagName).toBe('H1')
    expect(slot).toHaveTextContent('Facts')

    rerender(
      <DocumentBody
        html={TITLED.replace('How things move.', 'How things moved.')}
        label="The sync map"
        afterTitle={<p>Facts</p>}
      />,
    )
    await waitFor(() => {
      expect(article).toHaveTextContent('How things moved.')
    })
    expect(article.querySelector('[data-byline-slot]')).toHaveTextContent('Facts')
  })

  it('has nowhere to put it in a body with no title of its own', async () => {
    const { article } = await mounted('<article><h2>Only a section</h2></article>')
    expect(article.querySelector('[data-byline-slot]')).toBeNull()
  })

  it('mounts the rendered body into the reading article', async () => {
    const { article } = await mounted(TITLED)

    expect(article.firstElementChild?.tagName).toBe('H1')
    expect(screen.getByRole('heading', { level: 1, name: 'The sync map' })).toBeInTheDocument()
  })

  describe('the automatic eyebrow', () => {
    it('sits directly above a body that opens with its own title', async () => {
      const { article } = await mounted(TITLED, 'Architecture')

      const eyebrow = article.firstElementChild
      expect(eyebrow?.tagName).toBe('P')
      expect(eyebrow).toHaveTextContent('Architecture')
      expect(eyebrow?.nextElementSibling?.tagName).toBe('H1')
    })

    it('is text, not a heading, so the outline is unchanged', async () => {
      await mounted(TITLED, 'Architecture')

      expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
        'The sync map',
      ])
    })

    it('gives way to an eyebrow the author wrote', async () => {
      const { article } = await mounted(
        '<article><p>Overview</p><h1 id="t">The sync map</h1></article>',
        'Architecture',
      )

      expect(article).not.toHaveTextContent('Architecture')
      expect(article.firstElementChild).toHaveTextContent('Overview')
    })

    it('is not added to a body that does not open with a title', async () => {
      const { article } = await mounted('<article><p>Just prose.</p></article>', 'Architecture')

      expect(article).not.toHaveTextContent('Architecture')
    })

    it('follows the collection when it changes, without a second eyebrow', async () => {
      const { article, rerender } = await mounted(TITLED, 'Architecture')

      rerender(<DocumentBody html={TITLED} label="The sync map" eyebrow="Runbooks" />)

      await waitFor(() => {
        expect(article.firstElementChild).toHaveTextContent('Runbooks')
      })
      expect(article).not.toHaveTextContent('Architecture')
    })

    it('has no axe violations', async () => {
      const { container } = await mounted(TITLED, 'Architecture')

      await expectNoAccessibilityViolations(container)
    })
  })

  describe('tables (ADR-040)', () => {
    // Two tables as `@quill/markdown` renders them: one that scrolls, with a
    // numeric column, and one that stacks into cards on a phone.
    const TABLES = `<article><h1 id="t">Regions</h1>
<div class="table-block" data-width="full" data-freeze="header"><div class="table-scroll" tabindex="0" role="group" aria-label="Table"><table>
<colgroup><col width="60%"><col width="40%"></colgroup>
<thead><tr><th scope="col">Region</th><th scope="col" class="align-numeric">Budget</th></tr></thead>
<tbody><tr><td>eu</td><td class="align-numeric">120</td></tr><tr><td>us</td><td class="align-numeric">9</td></tr></tbody>
</table></div></div>
<div class="table-block" data-responsive="stack"><div class="table-scroll" tabindex="0" role="group" aria-label="Table"><table role="table">
<thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Service</th><th scope="col" role="columnheader">Owner</th></tr></thead>
<tbody role="rowgroup"><tr role="row"><td data-label="Service" role="cell">Gateway</td><td data-label="Owner" role="cell">Platform</td></tr><tr role="row"><td data-label="Service" role="cell">Ledger</td><td data-label="Owner" role="cell">Data</td></tr></tbody>
</table></div></div></article>`

    it('gives every table its sort buttons, named by their columns', async () => {
      await mounted(TABLES)

      const region = screen.getAllByRole('button', { name: 'Region' })
      expect(region).toHaveLength(1)
      region[0]?.click()
      expect(region[0]?.closest('th')).toHaveAttribute('aria-sort', 'ascending')
      expect(screen.getAllByRole('status')[0]).toHaveTextContent('Sorted by Region, ascending')
    })

    it('has no axe violations, with the hanging header in place', async () => {
      const { container } = await mounted(TABLES)

      await waitFor(() => {
        expect(container.querySelector('.table-sticky-head')).not.toBeNull()
      })
      await expectNoAccessibilityViolations(container)
    })

    // A captioned table with row headers and a totals footer, as rendered.
    const TOTALS = `<article><h1 id="t">Budgets</h1>
<div class="table-block" data-headers="both"><div class="table-scroll" tabindex="0" role="group" aria-labelledby="user-content-caption.1"><table>
<caption id="user-content-caption.1"><span class="table-caption-text">Latency budgets</span></caption>
<thead><tr><th scope="col">Region</th><th scope="col" class="align-numeric">Budget</th></tr></thead>
<tbody><tr><th scope="row">eu</th><td class="align-numeric">120</td></tr><tr><th scope="row">us</th><td class="align-numeric">90</td></tr></tbody>
<tfoot><tr><th scope="row">Total</th><td class="align-numeric">210</td></tr></tfoot>
</table></div></div></article>`

    it('names the table and its scroll region by the caption, and heads its rows', async () => {
      const { container } = await mounted(TOTALS)

      expect(screen.getByRole('table', { name: 'Latency budgets' })).toBeInTheDocument()
      expect(screen.getByRole('group', { name: 'Latency budgets' })).toBeInTheDocument()
      expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
        'eu',
        'us',
        'Total',
      ])
      await expectNoAccessibilityViolations(container)
    })

    it('opens the table full screen, with no axe violations, and gives focus back', async () => {
      HTMLDialogElement.prototype.showModal = openDialog
      HTMLDialogElement.prototype.close = closeDialog
      const user = userEvent.setup()
      await mounted(TOTALS)

      const expand = screen.getByRole('button', { name: 'Expand table: Latency budgets' })
      await user.click(expand)
      const dialog = screen.getByRole('dialog', { name: 'Latency budgets' })
      expect(dialog).toContainElement(screen.getByRole('table', { name: 'Latency budgets' }))
      await expectNoAccessibilityViolations(dialog)

      await user.click(screen.getByRole('button', { name: 'Close' }))
      expect(expand).toHaveFocus()
    })
  })

  describe('code (ADR-041)', () => {
    // A block and a group as `@quill/markdown` renders them.
    const CODE = `<article><h1 id="c">Requests</h1>
<div class="code-block"><pre><code data-lang="typescript">await fetch(url)</code></pre></div>
<div class="code-group"><figure class="code-block"><figcaption class="code-caption"><span class="code-label">TypeScript</span></figcaption><pre><code data-lang="typescript">fetch(url)</code></pre></figure><figure class="code-block"><figcaption class="code-caption"><span class="code-label">Python</span></figcaption><pre><code data-lang="python">requests.get(url)</code></pre></figure></div></article>`

    it('gives every block a copy button named by its language', async () => {
      await mounted(CODE)

      expect(screen.getAllByRole('button', { name: 'Copy TypeScript code' })).toHaveLength(2)
    })

    it('turns a group into tabs a keyboard can work', async () => {
      const user = userEvent.setup()
      await mounted(CODE)

      const tablist = screen.getByRole('tablist', { name: 'Code examples' })
      await user.click(screen.getByRole('tab', { name: 'TypeScript' }))
      await user.keyboard('{ArrowRight}')

      expect(screen.getByRole('tab', { name: 'Python' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('tab', { name: 'Python' })).toHaveFocus()
      expect(screen.getByRole('tabpanel', { name: 'Python' })).toBeVisible()
      expect(tablist.parentElement?.querySelector('.code-copy')).toHaveAccessibleName(
        'Copy Python code',
      )
    })

    it('has no axe violations', async () => {
      const { container } = await mounted(CODE)

      await expectNoAccessibilityViolations(container)
    })
  })

  describe('an animated emoji (ADR-047)', () => {
    const ANIMATED =
      '<article><p>Shipped <picture class="emoji" data-frames="12" data-loop-ms="1200">' +
      '<source srcset="/api/emoji/party.bbbbbbbbbbbbbbbb.gif" media="(prefers-reduced-motion: reduce)">' +
      '<img class="emoji" src="/api/emoji/party.aaaaaaaaaaaaaaaa.gif" alt=":party:" title=":party:" width="20" height="20">' +
      '</picture> today.</p></article>'

    it('is played briefly by the reader, named by its shortcode, at a fixed size', async () => {
      const { article } = await mounted(ANIMATED)

      const image = screen.getByRole('img', { name: ':party:' })
      expect(image).toHaveAttribute('width', '20')
      expect(image).toHaveAttribute('height', '20')
      expect(article.querySelector('picture')).toHaveAttribute('data-state')
    })

    it('has no axe violations', async () => {
      const { container } = await mounted(ANIMATED)

      await expectNoAccessibilityViolations(container)
    })
  })
})
