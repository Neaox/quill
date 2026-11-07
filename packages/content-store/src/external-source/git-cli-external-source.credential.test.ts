/**
 * Where the credential goes, end to end: every process the adapter starts is
 * recorded, and the remote is an `https` address that refuses the connection,
 * so the real `git` runs its real network path and fails without a server.
 */

import type { SpawnOptions } from 'node:child_process'
import type * as ChildProcess from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExternalSourceError } from '@quill/application'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { GitCliExternalSource } from './git-cli-external-source.ts'

interface Started {
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string | undefined>>
}

const started = vi.hoisted((): Started[] => [])

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>()
  return {
    ...actual,
    spawn: (command: string, args: readonly string[], options: SpawnOptions) => {
      started.push({ args, env: options.env ?? {} })
      return actual.spawn(command, args, options)
    },
  }
})

const root = await mkdtemp(join(tmpdir(), 'quill-external-credential-'))
afterAll(() => rm(root, { recursive: true, force: true, maxRetries: 5 }))

const TOKEN = 'ghs_quill-test-installation-token'
const ENCODED = Buffer.from(`x-access-token:${TOKEN}`).toString('base64')

async function refusal(promise: Promise<unknown>): Promise<ExternalSourceError> {
  const error: unknown = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof ExternalSourceError))
    throw new Error(`expected a refusal, got ${String(error)}`)
  return error
}

describe('GitCliExternalSource credentials', () => {
  it('mints a credential per request and hands it to git only in the environment', async () => {
    let minted = 0
    const source = await GitCliExternalSource.open({
      // Port 9 (discard) refuses connections on a machine that is not serving it.
      remote: 'https://127.0.0.1:9/acme/docs.git',
      branch: 'main',
      paths: ['docs'],
      cacheDirectory: join(root, 'cache'),
      outboundPolicy: { check: () => Promise.resolve({ allowed: true }) },
      credential: () => {
        minted += 1
        return Promise.resolve({ username: 'x-access-token', password: TOKEN })
      },
      networkTimeoutMs: 60_000,
    })

    const errors = [await refusal(source.head()), await refusal(source.fetch())]

    expect(minted).toBe(2)
    expect(errors.map((error) => error.reason)).toEqual(['command-failed', 'command-failed'])
    for (const error of errors) {
      expect(error.message).not.toContain(TOKEN)
      expect(error.message).not.toContain(ENCODED)
    }
    const network = started.filter(({ args }) => args[0] === 'ls-remote' || args[0] === 'clone')
    expect(network.map(({ args }) => args[0])).toEqual(['ls-remote', 'clone'])
    for (const { args, env } of started) {
      expect(args.join(' ')).not.toContain(TOKEN)
      expect(args.join(' ')).not.toContain(ENCODED)
      expect(Object.values(env).join(' ')).not.toContain(TOKEN)
    }
    for (const { env } of network) {
      expect(Object.values(env)).toContain(`Authorization: Basic ${ENCODED}`)
    }
  })
})
