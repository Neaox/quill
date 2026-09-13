import { randomUUID } from 'node:crypto'

import type { APIRequestContext } from '@playwright/test'

/**
 * What a browser sends on a state-changing request, and what the server's
 * CSRF defence requires of one that carries a session cookie (ADR-011,
 * `apps/server/src/plugins/csrf.ts`): fetch metadata saying the request came
 * from the app's own pages, and an `Origin` that matches the app's.
 *
 * Playwright's `APIRequestContext` is not a browser and sends neither, so a
 * fixture built through the real API has to say what it is. The origin is the
 * web application's, because that is where the session was issued.
 */
export const BROWSER_HEADERS: Readonly<Record<string, string>> = {
  origin: 'http://localhost:5173',
  'sec-fetch-site': 'same-origin',
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@example.com`
}

async function json<T>(response: {
  ok(): boolean
  status(): number
  json(): Promise<unknown>
}): Promise<T> {
  if (!response.ok()) {
    throw new Error(`Request failed with status ${response.status()}`)
  }
  return (await response.json()) as T
}

export interface WorkspaceFixture {
  readonly id: string
  readonly slug: string
  readonly name: string
}

/**
 * Creates a unit and a workspace under it, as the instance admin `request`
 * is signed in as (see `admin.ts`'s `signInAsAdmin` for how a test gets
 * there). Creating a workspace needs no pre-existing collection, unlike
 * creating a document in it (see `seed.ts`), so this is the one piece of
 * e2e fixture data still built from nothing through the real API.
 */
export async function createWorkspace(
  request: APIRequestContext,
  name: string,
): Promise<WorkspaceFixture> {
  const suffix = randomUUID().slice(0, 8)
  const unit = await json<{ id: string }>(
    await request.post('/api/units', {
      headers: BROWSER_HEADERS,
      data: { name: `${name} unit ${suffix}` },
    }),
  )
  const workspace = await json<{ id: string; slug: string; name: string }>(
    await request.post('/api/workspaces', {
      headers: BROWSER_HEADERS,
      data: {
        unitId: unit.id,
        name,
        slug: `${name.toLowerCase().replaceAll(/\s+/g, '-')}-${suffix}`,
      },
    }),
  )
  return workspace
}
