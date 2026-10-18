import { EMBED_PROVIDERS, createEmbedRegistry, unknownEmbedProviders } from '@quill/domain'
import type { EmbedRegistry } from '@quill/domain'

/**
 * Which embed providers an operator has switched off (ADR-042, "Embeds are an
 * allowlist"). The list of providers is code; this is the one dial an operator
 * has on it, and it only narrows: nothing here can add a provider, a host or a
 * frame origin.
 *
 * `LINK_EMBEDS_DISABLED` is a comma separated list of provider ids
 * (`youtube,vimeo`), or `all` for no live embeds on this instance. Each id is
 * checked at boot, since a typo that quietly left a provider on would be the
 * wrong way round for a switch whose job is to turn things off.
 */
export interface LinkEmbedsConfig {
  readonly disabled: readonly string[]
}

export function loadLinkEmbedsConfig(env: NodeJS.ProcessEnv): LinkEmbedsConfig {
  const raw = (env['LINK_EMBEDS_DISABLED'] ?? '').trim().toLowerCase()
  if (raw === '') return { disabled: [] }
  if (raw === 'all') return { disabled: EMBED_PROVIDERS.map((provider) => provider.id) }

  const disabled = raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '')
  const unknown = unknownEmbedProviders(disabled)
  if (unknown.length > 0) {
    throw new Error(
      `LINK_EMBEDS_DISABLED names ${unknown.join(', ')}, which ${unknown.length === 1 ? 'is' : 'are'} not embed providers. ` +
        `Known providers: ${EMBED_PROVIDERS.map((provider) => provider.id).join(', ')}.`,
    )
  }
  return { disabled }
}

/**
 * The allowlist this instance runs. Cheap and stateless, so the resolver, the
 * renderer and the CSP each ask for it from the same configuration and agree.
 */
export function linkEmbedRegistry(config: LinkEmbedsConfig): EmbedRegistry {
  return createEmbedRegistry(config.disabled)
}
