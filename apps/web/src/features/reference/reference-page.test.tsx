import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { renderApp } from '../../lib/api/render-app.tsx'
import { jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'

const me = () =>
  jsonResponse(200, {
    id: 'user-1',
    email: 'reader@example.com',
    displayName: 'Reader',
    emailVerified: true,
    isInstanceAdmin: false,
  })

const workspace = () =>
  jsonResponse(200, {
    id: 'acme',
    unitId: 'unit-1',
    name: 'Acme',
    slug: 'acme',
    createdAt: '2026-01-01T00:00:00.000Z',
  })

const tree = () => jsonResponse(200, { collections: [] })

const SNAPSHOT = {
  id: 'snapshot-1',
  kind: 'schema',
  sourceCommit: 'abc1234',
  capturedAt: '2026-01-01T00:00:00.000Z',
  artifactVersion: 1,
  artifactSize: 2048,
  symbolCount: 0,
  tableCount: 1,
  artifactUrl: '/api/workspaces/acme/reference/schema/artifact?snapshot=snapshot-1',
}

const SCHEMA = {
  formatVersion: 1,
  dialect: 'postgres',
  database: 'acme',
  source: 'catalog',
  capturedAt: '2026-01-01T00:00:00.000Z',
  tables: [
    {
      schema: 'public',
      name: 'accounts',
      kind: 'table',
      comment: 'One account.',
      columns: [
        {
          name: 'id',
          type: 'uuid',
          nullable: false,
          ordinal: 1,
          primaryKey: true,
          unique: false,
          comment: 'The account id.',
        },
      ],
      primaryKey: ['id'],
      unique: [],
      foreignKeys: [],
    },
  ],
  functions: [
    {
      schema: 'public',
      name: 'account_name',
      signature: 'public.account_name(uuid)',
      returns: 'text',
      securityDefiner: false,
      comment: 'Returns the account name for an id.',
    },
  ],
}

const CODE = {
  formatVersion: 1,
  tool: 'quill-code-index',
  commit: 'abc1234',
  repo: 'acme/api',
  generatedAt: '2026-01-01T00:00:00.000Z',
  files: {
    'a.ts': {
      path: 'a.ts',
      symbols: [
        {
          name: 'createAccount',
          kind: 'function',
          package: 'packages/accounts',
          module: 'create',
          signature: 'createAccount(input: Input): Promise<Account>',
          description: 'Creates an account and its first owner.',
        },
        {
          name: 'AccountCreated',
          kind: 'type',
          package: 'packages/accounts',
          module: 'events',
          signature: 'type AccountCreated = { id: string }',
          description: '',
        },
      ],
    },
  },
}

function routes(overrides: FakeRoutes = {}): FakeRoutes {
  return {
    'GET /api/me': me,
    'GET /api/workspaces/{id}': workspace,
    'GET /api/workspaces/{id}/tree': tree,
    'GET /api/workspaces/{id}/reference/{kind}': () =>
      jsonResponse(200, { latest: SNAPSHOT, history: [SNAPSHOT] }),
    'GET /api/workspaces/{id}/reference/{kind}/artifact': () => jsonResponse(200, SCHEMA),
    ...overrides,
  }
}

describe('ReferencePage', () => {
  it('says so when the workspace has no snapshot', async () => {
    renderApp(
      '/w/acme/reference',
      routes({
        'GET /api/workspaces/{id}/reference/{kind}': () =>
          jsonResponse(200, { latest: null, history: [] }),
      }),
    )

    expect(await screen.findByText('No snapshot yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Schema' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('loads a schema snapshot, browses its tables and filters them', async () => {
    const user = userEvent.setup()
    renderApp('/w/acme/reference', routes())

    expect(await screen.findByText('Schema snapshot')).toBeInTheDocument()
    expect(screen.getByText('abc1234')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Load snapshot' }))
    expect(await screen.findByText(/1 of 1 tables/)).toBeInTheDocument()

    const table = screen.getByText('public.accounts', { exact: true })
    await user.click(table)
    expect(screen.getByText('The account id.')).toBeInTheDocument()
    expect(screen.getByText('public.account_name(uuid)')).toBeInTheDocument()

    const filter = screen.getByLabelText('Filter tables and functions')
    await user.type(filter, 'owners')
    await user.keyboard('{Enter}')
    expect(await screen.findByText(/0 of 1 tables/)).toBeInTheDocument()

    const page = screen.getByRole('heading', { name: 'Reference' }).parentElement
    if (page === null) throw new Error('the reference page has no root')
    await expectNoAccessibilityViolations(page)
  })

  it('searches a code artifact only after a name is typed', async () => {
    const user = userEvent.setup()
    const codeSnapshot = { ...SNAPSHOT, kind: 'code', symbolCount: 2, tableCount: 0 }
    renderApp(
      '/w/acme/reference?kind=code',
      routes({
        'GET /api/workspaces/{id}/reference/{kind}': () =>
          jsonResponse(200, { latest: codeSnapshot, history: [codeSnapshot] }),
        'GET /api/workspaces/{id}/reference/{kind}/artifact': () => jsonResponse(200, CODE),
      }),
    )

    expect(await screen.findByText('Code snapshot')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Load snapshot' }))

    expect(await screen.findByText('2 symbols')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Find a symbol'), 'account')
    await user.keyboard('{Enter}')
    expect(await screen.findByText('createAccount')).toBeInTheDocument()
    expect(screen.getByText('AccountCreated')).toBeInTheDocument()

    const page = screen.getByRole('heading', { name: 'Reference' }).parentElement
    if (page === null) throw new Error('the reference page has no root')
    await expectNoAccessibilityViolations(page)
  })

  it('switches kind through the URL', async () => {
    const user = userEvent.setup()
    renderApp('/w/acme/reference', routes())
    await screen.findByText('Schema snapshot')

    await user.click(screen.getByRole('button', { name: 'Code' }))

    expect(await screen.findByText('Code snapshot')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Code' })).toHaveAttribute('aria-pressed', 'true')
  })
})
