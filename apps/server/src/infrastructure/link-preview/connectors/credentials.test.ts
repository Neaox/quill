import { isSecretName, setSecret } from '@quill/application'
import type { LinkConnector, SecretsDependencies } from '@quill/application'
import {
  createFakeClock,
  createFakeIdGenerator,
  createFakeSecretCipher,
  createInMemoryUnitOfWork,
} from '@quill/application/test-support'
import type { UserId } from '@quill/domain'
import { beforeEach, describe, expect, it } from 'vitest'

import { createConnectorCredentialSource } from './credentials.ts'
import { GITHUB_SECRET_NAME } from './github-connector.ts'

const ADMIN = 'admin-1' as UserId
const connector = (secretName: string): LinkConnector => ({
  id: 'test',
  hosts: [],
  secretName,
  matches: () => false,
  resolve: async () => {
    throw new Error('not used')
  },
})

let deps: SecretsDependencies
beforeEach(() => {
  deps = {
    uow: createInMemoryUnitOfWork(),
    secrets: createFakeSecretCipher(),
    clock: createFakeClock(new Date('2026-10-17T10:00:00.000Z')),
    ids: createFakeIdGenerator(),
  }
})

describe('connector credentials', () => {
  it('names a secret an administrator can enter on the secrets screen', () => {
    expect(isSecretName(GITHUB_SECRET_NAME)).toBe(true)
  })

  it('reads the secret the connector names, at the moment it is asked', async () => {
    const source = createConnectorCredentialSource(deps)
    expect(await source.forConnector(connector(GITHUB_SECRET_NAME))).toBeNull()

    await setSecret(deps, { name: GITHUB_SECRET_NAME, value: 'ghp_first', actor: ADMIN })
    expect(await source.forConnector(connector(GITHUB_SECRET_NAME))).toEqual({ token: 'ghp_first' })

    // A rotation takes effect on the next request, with nothing held in between.
    await setSecret(deps, { name: GITHUB_SECRET_NAME, value: 'ghp_second', actor: ADMIN })
    expect(await source.forConnector(connector(GITHUB_SECRET_NAME))).toEqual({
      token: 'ghp_second',
    })
  })

  it('does not hand one connector another’s secret', async () => {
    await setSecret(deps, { name: GITHUB_SECRET_NAME, value: 'ghp_first', actor: ADMIN })
    const source = createConnectorCredentialSource(deps)
    expect(await source.forConnector(connector('connectors/jira/token'))).toBeNull()
  })

  it('treats a secret that no longer opens as none, so the connector acts anonymously', async () => {
    const cipher = createFakeSecretCipher()
    const lost = { ...deps, secrets: cipher }
    await setSecret(lost, { name: GITHUB_SECRET_NAME, value: 'ghp_first', actor: ADMIN })
    cipher.forget('key-1')
    const source = createConnectorCredentialSource(lost)
    expect(await source.forConnector(connector(GITHUB_SECRET_NAME))).toBeNull()
  })
})
