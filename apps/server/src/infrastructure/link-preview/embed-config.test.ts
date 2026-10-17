import { EMBED_PROVIDERS } from '@quill/domain'
import { describe, expect, it } from 'vitest'

import { linkEmbedRegistry, loadLinkEmbedsConfig } from './embed-config.ts'

describe('loadLinkEmbedsConfig', () => {
  it('leaves every provider on when nothing is said', () => {
    expect(loadLinkEmbedsConfig({})).toEqual({ disabled: [] })
    expect(loadLinkEmbedsConfig({ LINK_EMBEDS_DISABLED: '  ' })).toEqual({ disabled: [] })
  })

  it('reads a comma separated list of provider ids, trimmed and lower-cased', () => {
    expect(loadLinkEmbedsConfig({ LINK_EMBEDS_DISABLED: ' YouTube, vimeo ,,' })).toEqual({
      disabled: ['youtube', 'vimeo'],
    })
  })

  it('turns every provider off with "all"', () => {
    expect(loadLinkEmbedsConfig({ LINK_EMBEDS_DISABLED: 'all' }).disabled).toEqual(
      EMBED_PROVIDERS.map((provider) => provider.id),
    )
  })

  it('refuses a name that is not a provider, rather than quietly leaving it on', () => {
    expect(() => loadLinkEmbedsConfig({ LINK_EMBEDS_DISABLED: 'youtube,youtub' })).toThrow(
      /LINK_EMBEDS_DISABLED.*youtub/u,
    )
  })
})

describe('linkEmbedRegistry', () => {
  it('is the allowlist minus what the operator disabled', () => {
    const registry = linkEmbedRegistry({ disabled: ['spotify'] })
    expect(registry.providers.map((provider) => provider.id)).not.toContain('spotify')
    expect(registry.providers).toHaveLength(EMBED_PROVIDERS.length - 1)
  })
})
