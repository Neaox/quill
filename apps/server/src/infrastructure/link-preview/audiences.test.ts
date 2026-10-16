import { PUBLIC_PREVIEW_SCOPE } from '@quill/application'
import { userId } from '@quill/domain'
import type { LinkPreviewPolicy } from '@quill/domain'
import { describe, expect, it, vi } from 'vitest'

import { createLinkPreviewAudiences } from './audiences.ts'
import type { PolicyFor } from './audiences.ts'

const ADA = userId('00000000-0000-4000-8000-00000000000a')
const rich: LinkPreviewPolicy = { mode: 'rich', allow: [], block: [] }

const audienceOf = (policy: LinkPreviewPolicy) =>
  createLinkPreviewAudiences(async () => policy).forPerson(ADA)

describe('createLinkPreviewAudiences', () => {
  it('reads for the public under the default policy, whatever a person is configured with', () => {
    const audience = createLinkPreviewAudiences(async () => ({ ...rich, mode: 'off' })).forPublic()
    expect(audience.scope).toBe(PUBLIC_PREVIEW_SCOPE)
    expect(audience.policy.images).toBe(true)
  })

  it('gives everyone the shared scope and the default policy until a policy is configured', async () => {
    const audience = await createLinkPreviewAudiences().forPerson(ADA)
    expect(audience.scope).toBe(PUBLIC_PREVIEW_SCOPE)
    expect(audience.policy.permits(new URL('https://anything.example/'))).toBe(true)
    expect(audience.policy.images).toBe(true)
  })

  it('keeps an organisation with no restrictions in the shared scope', async () => {
    expect((await audienceOf(rich)).scope).toBe(PUBLIC_PREVIEW_SCOPE)
  })

  it.each([
    ['an allow list', { ...rich, allow: ['docs.example'] }],
    ['a block list', { ...rich, block: ['tracker.example'] }],
    ['text only', { ...rich, mode: 'text' as const }],
    ['previews off', { ...rich, mode: 'off' as const }],
  ])('moves %s out of the shared scope', async (_name, policy) => {
    const audience = await audienceOf(policy)
    expect(audience.scope).toMatch(/^policy:[0-9a-f]{32}$/u)
  })

  it('puts two organisations with the same policy in one scope, however it was written', async () => {
    const one = await audienceOf({ mode: 'rich', allow: ['B.example', 'a.example'], block: [] })
    const other = await audienceOf({ mode: 'rich', allow: [' a.example', 'b.example '], block: [] })
    expect(one.scope).toBe(other.scope)
  })

  it('puts different policies in different scopes, so one never sees what the other fetched', async () => {
    const scopes = await Promise.all(
      [
        { ...rich, allow: ['a.example'] },
        { ...rich, allow: ['b.example'] },
        { ...rich, block: ['a.example'] },
        { ...rich, mode: 'text' as const },
        { ...rich, mode: 'off' as const },
      ].map(async (policy) => (await audienceOf(policy)).scope),
    )
    expect(new Set(scopes).size).toBe(scopes.length)
  })

  it('applies the policy it was given', async () => {
    const audience = await audienceOf({
      mode: 'text',
      allow: ['docs.example'],
      block: ['docs.example/private'],
    })
    expect(audience.policy.images).toBe(false)
    expect(audience.policy.permits(new URL('https://docs.example/a'))).toBe(true)
    expect(audience.policy.permits(new URL('https://docs.example/private/a'))).toBe(false)
    expect(audience.policy.permits(new URL('https://other.example/'))).toBe(false)
  })

  it('fails closed on a policy that cannot be compiled: previews off, never open', async () => {
    const audience = await audienceOf({ mode: 'rich', allow: [], block: ['not a host'] })
    expect(audience.policy.mode).toBe('off')
    expect(audience.policy.permits(new URL('https://anything.example/'))).toBe(false)
    expect(audience.scope).not.toBe(PUBLIC_PREVIEW_SCOPE)
  })

  it("asks for a person's policy each time but compiles a policy once", async () => {
    const policyFor = vi.fn<PolicyFor>(async () => ({ ...rich, allow: ['docs.example'] }))
    const audiences = createLinkPreviewAudiences(policyFor)
    const first = await audiences.forPerson(ADA)
    const second = await audiences.forPerson(ADA)
    expect(policyFor).toHaveBeenCalledTimes(2)
    expect(second).toBe(first)
  })

  it('does not remember policies without limit', async () => {
    let index = 0
    const audiences = createLinkPreviewAudiences(async () => ({
      ...rich,
      allow: [`h${index++}.example`],
    }))
    const scopes = new Set<string>()
    for (let i = 0; i < 200; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- sequential on purpose: each call builds the next policy.
      scopes.add((await audiences.forPerson(ADA)).scope)
    }
    expect(scopes.size).toBe(200)
  })
})
