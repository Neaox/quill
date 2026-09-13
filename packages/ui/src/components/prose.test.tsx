import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { Block } from './layout-grid.tsx'
import { Prose, ProseTable } from './prose.tsx'

describe('Prose', () => {
  it('renders document content as an article on the reading grid', async () => {
    const { container } = render(
      <Prose label="Failover runbook">
        <h1>Failover runbook</h1>
        <p>Follow these steps when the primary region stops answering.</p>
      </Prose>,
    )

    const article = screen.getByRole('article', { name: 'Failover runbook' })
    expect(article).toHaveClass('layout-grid', 'prose')
    expect(screen.getByRole('heading', { level: 1, name: 'Failover runbook' })).toBeInTheDocument()
    await expectNoAccessibilityViolations(container)
  })

  it('carries blocks at every width, including plain Markdown output', async () => {
    const { container } = render(
      <Prose>
        <p>A paragraph at the reading measure.</p>
        <Block width="wide">
          <ProseTable label="Regional latency budgets">
            <table>
              <caption>Latency budgets by region</caption>
              <thead>
                <tr>
                  <th scope="col">Region</th>
                  <th scope="col">Budget</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">eu-west</th>
                  <td>120 ms</td>
                </tr>
              </tbody>
            </table>
          </ProseTable>
        </Block>
        <Block width="full">
          <figure>
            <img src="/landscape.svg" alt="The system landscape" />
            <figcaption>Services and their dependencies.</figcaption>
          </figure>
        </Block>
        <ul>
          <li>A list item.</li>
        </ul>
        <blockquote>
          <p>Every publish is a revision.</p>
        </blockquote>
        <pre>
          <code>pnpm check</code>
        </pre>
      </Prose>,
    )

    expect(screen.getByRole('table', { name: 'Latency budgets by region' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'The system landscape' })).toBeInTheDocument()
    await expectNoAccessibilityViolations(container)
  })

  it('renders without a label when the surrounding page already names it', () => {
    render(
      <Prose className="py-10">
        <p>Body.</p>
      </Prose>,
    )

    const article = screen.getByRole('article')
    expect(article).not.toHaveAttribute('aria-label')
    expect(article).toHaveClass('py-10')
  })
})

describe('ProseTable', () => {
  it('is a labelled region that a keyboard user can reach and scroll', async () => {
    render(
      <ProseTable label="Regional latency budgets">
        <table>
          <tbody>
            <tr>
              <td>eu-west</td>
            </tr>
          </tbody>
        </table>
      </ProseTable>,
    )

    const region = screen.getByRole('group', { name: 'Regional latency budgets' })
    expect(region).toHaveClass('table-scroll')

    await userEvent.tab()
    expect(region).toHaveFocus()
  })

  it('appends caller classes', () => {
    render(
      <ProseTable label="Budgets" className="mt-6">
        <table>
          <tbody>
            <tr>
              <td>eu-west</td>
            </tr>
          </tbody>
        </table>
      </ProseTable>,
    )

    expect(screen.getByRole('group', { name: 'Budgets' })).toHaveClass('mt-6')
  })
})
